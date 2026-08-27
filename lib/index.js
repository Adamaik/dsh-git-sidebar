/**
 * dsh-git-sidebar — draggable right-side Git sidebar (host half)
 *
 * Registers JSON endpoints served to the browser:
 *   /git-sidebar/status     — branch, upstream, ahead/behind, changed files
 *   /git-sidebar/branches   — local + remote branch list
 *   /git-sidebar/checkout   — switch branch (refuses a dirty workspace)
 *   /git-sidebar/stage      — stage / unstage files
 *   /git-sidebar/commit     — stage-all + commit
 *   /git-sidebar/push       — git push
 *   /git-sidebar/pull       — git pull
 *   /git-sidebar/generate   — AI commit message from git status + diff
 *
 * Transport: the webServer service registers the routes; the browser half
 * fetches JSON. Only scalars/arrays are serialized — no live objects.
 *
 * The git root is resolved per request from the workspace cwd passed by the
 * client, walking up to find .git and caching per workspace.
 */

export const name = 'dsh-git-sidebar'
// Dependencies must be declared via `inject` (ctx.get may return undefined for them)
export const inject = ['webServer', 'shell', 'sandboxPolicy']

const API_BASE = '/git-sidebar'
const MAX_BODY_BYTES = 4 * 1024 * 1024
const STATUS_CHARS = [' ', '?', 'A', 'M', 'D', 'R', 'C', 'T', 'U']

function dirname(p) {
  const s = String(p).replace(/[\\/]+$/, '')
  const i = s.lastIndexOf('/')
  if (i <= 0) return i === 0 ? '/' : ''
  return s.slice(0, i)
}

function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

function isConflict(code) {
  const x = code[0]
  const y = code[1]
  return x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')
}

function looksLikeStatus(rec) {
  return (
    rec.length >= 3 &&
    STATUS_CHARS.indexOf(rec[0]) >= 0 &&
    STATUS_CHARS.indexOf(rec[1]) >= 0 &&
    rec[2] === ' '
  )
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return null
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

export function apply(ctx) {
  const webServer = ctx.webServer
  const shell = ctx.shell
  const sp = ctx.get('sandboxPolicy')
  const llm = ctx.get('llm')
  const adm = ctx.get('agentDefaultModel')
  if (webServer === undefined || shell === undefined) return
  const defaultBase = sp && sp.workspaceRoot ? sp.workspaceRoot : undefined
  const rootCache = new Map()

  async function gitRun(cmd, opts) {
    try {
      const request = {
        command: cmd,
        workdir: (opts && opts.cwd) || defaultBase || undefined,
        timeoutMs: (opts && opts.timeoutMs) || 60000,
        stdoutMaxBytes: (opts && opts.cap) || 4 * 1024 * 1024,
      }
      const spec = shell.resolve(request)
      const r = await shell.run(spec)
      const stdout = (r.stdout && r.stdout.text) || ''
      const stderr = (r.stderr && r.stderr.text) || ''
      return { ok: r.exitCode === 0, exitCode: r.exitCode, stdout, stderr }
    } catch (err) {
      return { ok: false, exitCode: null, stdout: '', stderr: '', error: String((err && err.message) || err) }
    }
  }

  async function findGitRoot(base) {
    const start = base || defaultBase
    if (start === undefined) return undefined
    if (rootCache.has(start)) return rootCache.get(start)
    let found
    let dir = start
    for (let i = 0; i < 8; i++) {
      const r = await gitRun('git rev-parse --show-toplevel', { cwd: dir })
      if (r.ok && r.stdout.trim()) {
        found = r.stdout.trim().split('\n')[0]
        break
      }
      const parent = dirname(dir)
      if (!parent || parent === dir) break
      dir = parent
    }
    if (!found) {
      const f = await gitRun(`find ${shq(start)} -maxdepth 2 -name .git -type d 2>/dev/null | head -1`, { cwd: start, cap: 4096 })
      if (f.ok && f.stdout.trim()) {
        const parent = dirname(f.stdout.trim().split('\n')[0])
        if (parent) {
          const v = await gitRun('git rev-parse --show-toplevel', { cwd: parent })
          if (v.ok && v.stdout.trim()) found = v.stdout.trim().split('\n')[0]
        }
      }
    }
    rootCache.set(start, found)
    return found
  }

  async function readStatus(base) {
    const start = base || defaultBase
    const root = await findGitRoot(start)
    if (!root) {
      return { ok: false, error: `未找到 Git 仓库：${start || '当前工作区'} 及上级目录均无 .git` }
    }
    const r = await gitRun('git status --porcelain=v1 -z -b', { cwd: root, cap: 2 * 1024 * 1024 })
    if (!r.ok) return { ok: false, error: (r.stderr || r.stdout || 'git status 失败').trim() }
    const parts = r.stdout.split('\0')
    const header = (parts[0] || '').replace(/\n$/, '')
    let branch = '?', upstream = ''
    let ahead = 0, behind = 0
    const m = /^## (.+?)(?:\.\.\.(.+?))?(?: \[(.*)\])?$/.exec(header)
    if (m) {
      branch = m[1]
      upstream = m[2] || ''
      const info = m[3] || ''
      const am = /ahead (\d+)/.exec(info)
      const bm = /behind (\d+)/.exec(info)
      ahead = am ? parseInt(am[1], 10) : 0
      behind = bm ? parseInt(bm[1], 10) : 0
    }
    const files = []
    for (let i = 1; i < parts.length; i++) {
      const rec = parts[i] || ''
      if (!rec) continue
      if (!looksLikeStatus(rec)) continue
      const x = rec[0]
      const y = rec[1]
      const path = rec.slice(3)
      if (!path) continue
      const untracked = x === '?' && y === '?'
      files.push({
        path,
        code: untracked ? '??' : x + y,
        staged: !untracked && x !== ' ',
        unstaged: !untracked && y !== ' ' && y !== '?',
        untracked,
        conflict: untracked ? false : isConflict(x + y),
      })
      if (x === 'R' || x === 'C') i++
    }
    return {
      ok: true,
      root,
      branch,
      upstream,
      ahead,
      behind,
      files,
      stagedCount: files.filter((f) => f.staged).length,
      unstagedCount: files.filter((f) => !f.staged).length,
      clean: files.length === 0,
    }
  }

  function cwdOf(body) {
    return body && body.cwd ? String(body.cwd) : defaultBase
  }

  function route(path, handler) {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path,
      handler: async (req, res) => {
        try {
          const body = await readJson(req)
          const result = await handler(body)
          sendJson(res, 200, result)
        } catch (err) {
          sendJson(res, 400, { ok: false, error: String((err && err.message) || err) })
        }
      },
    }), `dsh-git-sidebar: ${path}`)
  }

  route(`${API_BASE}/status`, async (body) => readStatus(cwdOf(body)))

  route(`${API_BASE}/branches`, async (body) => {
    const root = await findGitRoot(cwdOf(body))
    if (!root) return { ok: false, error: '未找到 Git 仓库' }
    const [local, remote, cur] = await Promise.all([
      gitRun(`git for-each-ref '--format=%(refname:short)' refs/heads`, { cwd: root }),
      gitRun(`git for-each-ref '--format=%(refname:short)' refs/remotes`, { cwd: root }),
      gitRun('git rev-parse --abbrev-ref HEAD', { cwd: root }),
    ])
    if (!local.ok || !cur.ok) return { ok: false, error: (local.stderr || cur.stderr || '获取分支失败').trim() }
    const branches = (local.stdout || '').split('\n').filter(Boolean).map((name) => ({ name, isRemote: false }))
    if (remote.ok) {
      ;(remote.stdout || '').split('\n').filter(Boolean).forEach((name) => {
        if (name === 'origin/HEAD' || /\/HEAD$/.test(name)) return
        if (!branches.some((b) => b.name === name)) branches.push({ name, isRemote: true })
      })
    }
    return { ok: true, current: (cur.stdout || '').trim(), branches }
  })

  route(`${API_BASE}/checkout`, async (body) => {
    const root = await findGitRoot(cwdOf(body))
    if (!root) return { ok: false, error: '未找到 Git 仓库' }
    const name = body && body.name ? String(body.name) : ''
    if (!name) return { ok: false, error: '未指定分支' }
    const isRemote = !!(body && body.isRemote)
    const st = await readStatus(cwdOf(body))
    if (st.ok && !st.clean) {
      return {
        ok: false,
        code: 'dirty-workspace',
        error: `工作区有 ${st.files.length} 个未提交变更，切换分支可能丢失这些更改`,
      }
    }
    let cmd
    if (isRemote) {
      const short = name.split('/').slice(1).join('/')
      const exists = await gitRun(`git rev-parse --verify --quiet ${shq(short)}`, { cwd: root })
      cmd = exists.ok ? `git checkout ${shq(short)}` : `git checkout -b ${shq(short)} --track ${shq(name)}`
    } else {
      cmd = `git checkout ${shq(name)}`
    }
    const r = await gitRun(cmd, { cwd: root, timeoutMs: 120000 })
    if (!r.ok) return { ok: false, error: (r.stderr || r.stdout || '切换分支失败').trim() }
    return { ok: true, notice: `已切换到 ${name}${isRemote ? '（新建跟踪分支）' : ''}` }
  })

  route(`${API_BASE}/stage`, async (body) => {
    const root = await findGitRoot(cwdOf(body))
    if (!root) return { ok: false, error: '未找到 Git 仓库' }
    const paths = (body && Array.isArray(body.paths) && body.paths.map(String)) || []
    if (!paths.length) return { ok: false, error: '未指定文件' }
    const quoted = paths.map(shq).join(' ')
    const r = body && body.staged
      ? await gitRun(`git add -- ${quoted}`, { cwd: root })
      : await gitRun(`git reset -- ${quoted}`, { cwd: root })
    if (!r.ok) return { ok: false, error: (r.stderr || r.stdout || '操作失败').trim() }
    return { ok: true }
  })

  route(`${API_BASE}/commit`, async (body) => {
    const root = await findGitRoot(cwdOf(body))
    if (!root) return { ok: false, error: '未找到 Git 仓库' }
    const msg = body && body.message ? String(body.message).trim() : ''
    if (!msg) return { ok: false, error: '提交信息不能为空' }
    if (body === null || body === undefined || body.all !== false) {
      const add = await gitRun('git add -A', { cwd: root })
      if (!add.ok) return { ok: false, error: (add.stderr || add.stdout || 'git add 失败').trim() }
    }
    const c = await gitRun(`git commit -m ${shq(msg)}`, { cwd: root })
    if (!c.ok) return { ok: false, error: (c.stderr || c.stdout || 'git commit 失败').trim() }
    return { ok: true, notice: (c.stdout || '').split('\n')[0] || '提交成功' }
  })

  route(`${API_BASE}/push`, async (body) => {
    const root = await findGitRoot(cwdOf(body))
    if (!root) return { ok: false, error: '未找到 Git 仓库' }
    const r = await gitRun('git push', { cwd: root, timeoutMs: 300000 })
    if (!r.ok) return { ok: false, error: (r.stderr || r.stdout || 'git push 失败').trim() }
    return { ok: true, notice: (r.stdout || '推送成功').trim() || '推送成功' }
  })

  route(`${API_BASE}/pull`, async (body) => {
    const root = await findGitRoot(cwdOf(body))
    if (!root) return { ok: false, error: '未找到 Git 仓库' }
    const r = await gitRun('git pull', { cwd: root, timeoutMs: 300000 })
    if (!r.ok) return { ok: false, error: (r.stderr || r.stdout || 'git pull 失败').trim() }
    return { ok: true, notice: (r.stdout || '拉取完成').trim() || '拉取完成' }
  })

  route(`${API_BASE}/generate`, async (body) => {
    const st = await readStatus(cwdOf(body))
    if (!st.ok) return st
    if (st.clean) return { ok: false, error: '工作区没有变更' }
    const root = st.root
    // 只取统计概览 + 受限的 diff 片段，避免把全量差异灌给模型拖慢生成
    const [statR, diffR] = await Promise.all([
      gitRun('git diff HEAD --stat', { cwd: root, cap: 8000 }),
      gitRun('git diff HEAD', { cwd: root, cap: 8000 }),
    ])
    if (!diffR.ok && diffR.stderr) return { ok: false, error: diffR.stderr.trim() }
    const stat = (statR.stdout || '').trim()
    const diff = (diffR.stdout || '').slice(0, 6000)
    if (!llm) return { ok: false, error: 'LLM 服务不可用' }
    if (!adm) return { ok: false, error: '默认模型服务不可用' }
    const sel = adm.currentSelection()
    if (!sel || !sel.provider || !sel.model) return { ok: false, error: '未配置默认模型，无法生成提交信息' }
    const fileLines = st.files.map((f) => `  ${f.code} ${f.path}`).join('\n')
    const prompt = [
      '你是一名资深开发者。请根据下面的 Git 变更生成一条提交信息。',
      '要求：',
      '1. 使用 Conventional Commits 风格：<type>(<scope>): <subject>，type 取 feat/fix/refactor/docs/style/chore/test/perf 之一；',
      '2. subject 用简洁的中文描述，不超过 50 个字符；',
      '3. 只输出提交信息本身，不要任何解释、前缀或引号。',
      '',
      `当前分支：${st.branch}`,
      '变更文件：',
      fileLines,
      '',
      '变更统计：',
      stat || '（无）',
      '',
      'Diff 摘要：',
      diff || '（无可展示的 diff，仅有未跟踪文件）',
    ].join('\n')
    let text = ''
    let failed = false
    const stream = llm.stream({
      provider: sel.provider,
      model: sel.model,
      temperature: 0.4,
      maxTokens: 150,
      messages: [
        {
          id: `dsh-git-gen-${Date.now()}`,
          role: 'user',
          content: [{ type: 'text', text: prompt }],
          source: { kind: 'user' },
        },
      ],
    })
    for await (const chunk of stream) {
      if (!chunk) continue
      if (chunk.type === 'text-delta') text += chunk.text || ''
      else if (chunk.type === 'finish') {
        if (chunk.reason === 'error' || chunk.reason === 'aborted') failed = true
        break
      }
    }
    if (failed) return { ok: false, error: '模型调用失败' }
    const msg = text.trim()
    if (!msg) return { ok: false, error: '模型未返回内容' }
    return { ok: true, message: msg }
  })
}