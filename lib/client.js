window.__ModuleLoader__.load({
  id: "dsh-git-sidebar",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");

    const API_BASE = "/git-sidebar";

    async function api(path, body) {
      const res = await fetch(`${API_BASE}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body === undefined ? "{}" : JSON.stringify(body),
      });
      return res.json();
    }

    // 跨组件共享开合状态：按钮（写）与面板（读）同步。
    const store = { open: false, listeners: new Set() };
    function setOpen(v) {
      store.open = v;
      for (const fn of store.listeners) fn();
    }
    function useOpen() {
      const [open, set] = react.useState(store.open);
      react.useEffect(() => {
        const fn = () => set(store.open);
        store.listeners.add(fn);
        return () => store.listeners.delete(fn);
      }, []);
      return open;
    }

    function currentCwd(ctx) {
      try {
        const snap = ctx.sessions.list.getSnapshot();
        const row = snap.current && snap.byId ? snap.byId[snap.current] : undefined;
        return (row && row.cwd) || "";
      } catch (e) {
        return "";
      }
    }

    function GitIcon() {
      return react.createElement(
        "svg",
        { width: 15, height: 15, viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": true },
        react.createElement("path", { d: "M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" })
      );
    }

    function FabButton() {
      const open = useOpen();
      const [top, setTop] = react.useState(null);
      const [dragging, setDragging] = react.useState(false);
      const dragRef = react.useRef(null);

      const onMouseDown = react.useCallback((e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const startTop = top === null ? (window.innerHeight - 92) / 2 : top;
        dragRef.current = { startY: e.clientY, startTop, moved: false };
        const onMove = (ev) => {
          const d = dragRef.current;
          if (!d) return;
          const dy = ev.clientY - d.startY;
          if (Math.abs(dy) > 2) d.moved = true;
          const maxTop = window.innerHeight - 92 - 8;
          setTop(Math.max(4, Math.min(d.startTop + dy, maxTop)));
        };
        const onUp = () => {
          dragRef.current = null;
          setDragging(false);
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        setDragging(true);
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      }, [top]);

      const onClick = () => {
        const d = dragRef.current;
        if (d && d.moved) return;
        setOpen(!open);
      };

      return react.createElement(
        "button",
        {
          className: "dshgit-fab" + (open ? " active" : "") + (dragging ? " dragging" : ""),
          style: top === null ? undefined : { top: `${top}px` },
          title: open ? "关闭 Git 面板" : "打开 Git 面板",
          onMouseDown,
          onClick,
          "aria-label": "Git 面板",
        },
        react.createElement(GitIcon, null),
        react.createElement("span", { className: "dshgit-fab-label" }, "Git")
      );
    }

    function GitPanel(ctx) {
      const [status, setStatus] = react.useState(null);
      const [loading, setLoading] = react.useState(false);
      const [msg, setMsg] = react.useState("");
      const [gen, setGen] = react.useState(false);
      const [busy, setBusy] = react.useState("");
      const [err, setErr] = react.useState("");
      const [ok, setOk] = react.useState("");
      const [all, setAll] = react.useState(true);
      const [branchOpen, setBranchOpen] = react.useState(false);
      const [branches, setBranches] = react.useState(null);
      const [pendingCheckout, setPendingCheckout] = react.useState(null);

      const refresh = react.useCallback(async () => {
        setLoading(true);
        setErr("");
        setOk("");
        try {
          const r = await api("status", { cwd: currentCwd(ctx) });
          if (r && r.ok) setStatus(r);
          else setErr((r && r.error) || "获取状态失败");
        } catch (e) {
          setErr(String((e && e.message) || e));
        }
        setLoading(false);
      }, []);

      react.useEffect(() => {
        refresh();
      }, [refresh]);

      // 会话切换（换会话/换工作区）时自动刷新到新目录
      react.useEffect(() => {
        if (ctx.sessions && ctx.sessions.list && ctx.sessions.list.subscribe) {
          let lastCwd = currentCwd(ctx);
          const fn = () => {
            const cwd = currentCwd(ctx);
            if (cwd !== lastCwd) {
              lastCwd = cwd;
              setStatus(null);
              refresh();
            }
          };
          return ctx.sessions.list.subscribe(fn);
        }
        return undefined;
      }, [refresh]);

      function loadBranches() {
        setBranches(null);
        api("branches", { cwd: currentCwd(ctx) })
          .then((r) => {
            if (r && r.ok) setBranches(r);
            else if (r && !r.ok) setErr((r && r.error) || "获取分支失败");
          })
          .catch((e) => {
            setBranches(null);
            setErr(String((e && e.message) || e));
          });
      }

      function toggleBranch() {
        if (branchOpen) {
          setBranchOpen(false);
          return;
        }
        setBranchOpen(true);
        loadBranches();
      }

      function pickBranch(b) {
        setBranchOpen(false);
        if (status && b.name === status.branch) return;
        const dirty = status && status.files && status.files.length > 0;
        if (dirty) {
          setPendingCheckout(b);
          return;
        }
        doCheckout(b);
      }

      function doCheckout(b) {
        setBusy("切换");
        setErr("");
        setOk("");
        api("checkout", { name: b.name, isRemote: !!b.isRemote, cwd: currentCwd(ctx) })
          .then(async (r) => {
            if (r && r.ok) {
              if (r.notice) setOk(r.notice);
              const [s, br] = await Promise.all([
                api("status", { cwd: currentCwd(ctx) }),
                api("branches", { cwd: currentCwd(ctx) }),
              ]);
              if (s && s.ok) setStatus(s);
              if (br && br.ok) setBranches(br);
              setPendingCheckout(null);
            } else {
              setErr((r && r.error) || "切换分支失败");
              setPendingCheckout(null);
            }
          })
          .catch((e) => {
            setErr(String((e && e.message) || e));
            setPendingCheckout(null);
          })
          .finally(() => setBusy(""));
      }

      function doOp(label, fn) {
        setBusy(label);
        setErr("");
        setOk("");
        Promise.resolve(fn())
          .then(async (r) => {
            if (r && r.ok) {
              if (r.notice) setOk(r.notice);
              try {
                const s = await api("status", { cwd: currentCwd(ctx) });
                if (s && s.ok) setStatus(s);
              } catch (e) {}
            } else {
              setErr((r && r.error) || label + "失败");
            }
          })
          .catch((e) => setErr(String((e && e.message) || e)))
          .finally(() => setBusy(""));
      }

      function doGenerate() {
        setGen(true);
        setErr("");
        setOk("");
        api("generate", { cwd: currentCwd(ctx) })
          .then((r) => {
            if (r && r.ok) {
              setMsg(r.message);
              setOk("已生成，可直接编辑后提交");
            } else {
              setErr((r && r.error) || "生成失败");
            }
          })
          .catch((e) => setErr(String((e && e.message) || e)))
          .finally(() => setGen(false));
      }

      function toggleFile(f) {
        doOp(f.staged ? "取消暂存" : "暂存", () =>
          api("stage", { paths: [f.path], staged: !f.staged, cwd: currentCwd(ctx) }));
      }

      function commit() {
        doOp("提交", () => api("commit", { message: msg, all, cwd: currentCwd(ctx) }));
      }

      function badgeLetter(f) {
        if (f.untracked) return "?";
        if (f.staged && f.code[0] !== " ") return f.code[0];
        if (f.code[1] !== " " && f.code[1] !== "?") return f.code[1];
        return f.code[0];
      }

      function badgeCls(f) {
        const L = badgeLetter(f);
        const cls = { M: "M", A: "A", D: "D", R: "R", C: "C", U: "U" }[L];
        return cls ? " dshgit-badge-" + cls : "";
      }

      function FileRow(f) {
        return react.createElement(
          "button",
          {
            key: f.path,
            className: "dshgit-file" + (f.staged ? " staged" : ""),
            onClick: () => toggleFile(f),
            title: (f.staged ? "取消暂存：" : "暂存：") + f.path,
          },
          react.createElement("span", { className: "dshgit-badge" + badgeCls(f) }, badgeLetter(f)),
          react.createElement("span", { className: "dshgit-filepath" }, f.path)
        );
      }

      const files = (status && status.files) || [];
      const staged = files.filter((f) => f.staged);
      const rest = files.filter((f) => !f.staged);
      const dirtyCount = files.length;

      const branchDesc =
        !status
          ? "加载中…"
          : status.upstream
            ? "→ " + status.upstream.split("/").slice(1).join("/") +
              (status.ahead || status.behind
                ? " (" + (status.ahead ? "领先 " + status.ahead : "") +
                  (status.ahead && status.behind ? " / " : "") +
                  (status.behind ? "落后 " + status.behind : "") + ")"
                : "")
            : "（无上游分支）";

      const branchItems = (branches && branches.branches) || null;

      return react.createElement(
        "div",
        null,
        react.createElement("div", { className: "dshgit-scrim", onClick: () => setOpen(false) }),
        react.createElement(
          "div",
          { className: "dshgit-panel" },
          react.createElement(
            "div",
            { className: "dshgit-head" },
            react.createElement(
              "div",
              { className: "dshgit-title" },
              react.createElement(GitIcon, null),
              react.createElement("span", null, "Git 面板")
            ),
            react.createElement("button", { className: "dshgit-close", title: "关闭", onClick: () => setOpen(false) }, "✕")
          ),
          react.createElement(
            "div",
            { className: "dshgit-meta" },
            react.createElement(
              "div",
              { className: "dshgit-branch" },
              react.createElement(
                "button",
                { className: "dshgit-branch-chip", title: "切换分支", onClick: toggleBranch },
                react.createElement("span", null, status ? status.branch : "…"),
                react.createElement("span", { className: "dshgit-caret" }, "▼")
              ),
              react.createElement("span", { className: "dshgit-branch-desc" }, branchDesc),
              branchOpen && branchItems
                ? react.createElement(
                    "div",
                    { className: "dshgit-dropdown" },
                    branchItems.map((b) =>
                      react.createElement(
                        "button",
                        {
                          key: (b.isRemote ? "r:" : "l:") + b.name,
                          className:
                            "dshgit-drop-item" +
                            (status && b.name === status.branch ? " active" : "") +
                            (b.isRemote ? " remote" : ""),
                          onClick: () => pickBranch(b),
                        },
                        react.createElement("span", null, b.name),
                        status && b.name === status.branch
                          ? react.createElement("span", { className: "dshgit-drop-tag" }, "当前")
                          : null,
                        b.isRemote ? react.createElement("span", { className: "dshgit-drop-tag" }, "remote") : null
                      )
                    )
                  )
                : null
            ),
            pendingCheckout
              ? react.createElement(
                  "div",
                  { className: "dshgit-warn" },
                  react.createElement("span", null, `工作区有 ${dirtyCount} 个未提交变更，切换分支可能丢失，确定继续？`),
                  react.createElement(
                    "span",
                    { className: "dshgit-warnbtns" },
                    react.createElement("button", { className: "dshgit-btn dshgit-btn-danger", disabled: !!busy, onClick: () => doCheckout(pendingCheckout) }, "确认切换"),
                    react.createElement("button", { className: "dshgit-btn", disabled: !!busy, onClick: () => setPendingCheckout(null) }, "取消")
                  )
                )
              : null,
            react.createElement("div", { className: "dshgit-rootpath", title: status ? status.root : "" }, status ? status.root : "")
          ),
          react.createElement(
            "div",
            { className: "dshgit-toolbar" },
            react.createElement("button", { className: "dshgit-btn", disabled: !!busy, onClick: refresh }, "刷新"),
            react.createElement(
              "button",
              {
                className: "dshgit-btn",
                disabled: !!busy || !files.length,
                onClick: () =>
                  doOp("全部操作", () =>
                    api("stage", { paths: files.map((f) => f.path), staged: rest.length > 0, cwd: currentCwd(ctx) })),
              },
              rest.length > 0 ? "全部暂存" : "全部取消"
            )
          ),
          react.createElement(
            "div",
            { className: "dshgit-files" },
            !status && loading
              ? react.createElement("div", { className: "dshgit-nofiles" }, "加载中…")
              : status && files.length === 0
                ? react.createElement("div", { className: "dshgit-nofiles" }, "工作区干净，没有变更 ✓")
                : react.createElement(
                    react.Fragment,
                    null,
                    staged.length
                      ? react.createElement(
                          react.Fragment,
                          null,
                          react.createElement("div", { className: "dshgit-section-title" }, "已暂存 ( " + staged.length + " )"),
                          staged.map(FileRow)
                        )
                      : null,
                    rest.length
                      ? react.createElement(
                          react.Fragment,
                          null,
                          react.createElement("div", { className: "dshgit-section-title" }, "未暂存 ( " + rest.length + " )"),
                          rest.map(FileRow)
                        )
                      : null
                  )
          ),
          react.createElement(
            "div",
            { className: "dshgit-commitbox" },
            react.createElement("textarea", {
              className: "dshgit-msg",
              placeholder: "输入提交信息…（或点击 ✨ 自动生成）",
              value: msg,
              onChange: (e) => setMsg(e.target.value),
            }),
            react.createElement(
              "div",
              { className: "dshgit-genrow" },
              react.createElement(
                "button",
                { className: "dshgit-btn dshgit-btn-gen", disabled: gen || !!busy || !status || status.clean, onClick: doGenerate },
                gen ? "生成中…" : "✨ 自动生成"
              ),
              react.createElement(
                "label",
                null,
                react.createElement("input", { type: "checkbox", checked: all, onChange: (e) => setAll(e.target.checked) }),
                "提交时包含全部更改"
              )
            ),
            react.createElement(
              "div",
              { className: "dshgit-actions" },
              react.createElement(
                "button",
                { className: "dshgit-btn dshgit-btn-primary", disabled: busy === "提交" || !msg.trim(), onClick: commit },
                busy === "提交" ? "提交中…" : "提交"
              ),
              react.createElement(
                "button",
                { className: "dshgit-btn", disabled: !!busy, onClick: () => doOp("推送", () => api("push", { cwd: currentCwd(ctx) })) },
                busy === "推送" ? "推送中…" : "推送"
              ),
              react.createElement(
                "button",
                { className: "dshgit-btn", disabled: !!busy, onClick: () => doOp("拉取", () => api("pull", { cwd: currentCwd(ctx) })) },
                busy === "拉取" ? "拉取中…" : "拉取"
              )
            ),
            ok ? react.createElement("div", { className: "dshgit-status ok" }, ok) : null,
            err ? react.createElement("div", { className: "dshgit-status err" }, err) : null,
            loading && status ? react.createElement("div", { className: "dshgit-status load" }, "刷新中…") : null
          )
        )
      );
    }

    function SidebarToggle() {
      const open = useOpen();
      return react.createElement(
        "button",
        { className: "dshgit-toggle" + (open ? " active" : ""), title: "Git 面板", onClick: () => setOpen(true) },
        react.createElement(GitIcon, null)
      );
    }

    const inject = ["slots", "sessions", "timer"];

    function apply(ctx) {
      // 注入样式表（插件级样式，卸载自动移除）
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-git-sidebar";
      tag.textContent = `
.dshgit-layer{pointer-events:none}
.dshgit-fab{position:fixed;right:0;top:50%;pointer-events:auto;z-index:2147483000;width:32px;height:92px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;border:none;border-radius:9px 0 0 9px;border-right:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));background:var(--dsw-alias-bg-layer-1,#1e1f22);color:var(--dsw-alias-label-secondary,#9aa0a6);cursor:grab;box-shadow:-4px 0 14px rgba(0,0,0,.25);font-family:inherit;user-select:none;touch-action:none}
.dshgit-fab:active{cursor:grabbing}
.dshgit-fab:hover{color:var(--dsw-alias-label-primary,#e6e8eb);background:var(--dsw-alias-bg-overlay,#26272b)}
.dshgit-fab.active{color:var(--dsw-alias-brand-primary,#7aa5ff);background:rgba(76,141,255,.14);border-color:var(--dsw-alias-brand-primary,#4c8dff)}
.dshgit-fab-label{writing-mode:vertical-rl;font-size:10.5px;letter-spacing:2px;font-weight:600;pointer-events:none}
.dshgit-scrim{position:fixed;inset:0;pointer-events:auto;background:rgba(0,0,0,.35)}
.dshgit-panel{position:fixed;top:0;right:0;bottom:0;width:400px;max-width:88vw;pointer-events:auto;background:var(--dsw-alias-bg-layer-1,#1e1f22);border-left:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));display:flex;flex-direction:column;box-shadow:-8px 0 24px rgba(0,0,0,.25);animation:dshgitIn .18s ease-out;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}
@keyframes dshgitIn{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}
.dshgit-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08))}
.dshgit-title{font-weight:600;font-size:13px;color:var(--dsw-alias-label-primary,#e6e8eb);flex:1;display:flex;align-items:center;gap:7px}
.dshgit-close{background:none;border:none;color:var(--dsw-alias-label-secondary,#9aa0a6);cursor:pointer;font-size:15px;line-height:1;padding:3px 8px;border-radius:4px}
.dshgit-close:hover{background:rgba(127,127,127,.15);color:var(--dsw-alias-label-primary,#e6e8eb)}
.dshgit-meta{padding:8px 14px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));display:flex;flex-direction:column;gap:6px}
.dshgit-branch{display:flex;align-items:center;gap:8px;font-weight:600;font-size:12.5px;color:var(--dsw-alias-label-primary,#e6e8eb);position:relative;align-items:flex-start}
.dshgit-branch-chip{border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));border-radius:999px;padding:1px 9px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:500;display:inline-flex;align-items:center;gap:4px;cursor:pointer;background:none;color:var(--dsw-alias-label-primary,#e6e8eb);flex-shrink:0;white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis}
.dshgit-branch-chip:hover{border-color:var(--dsw-alias-brand-primary,#4c8dff);color:var(--dsw-alias-brand-primary,#7aa5ff)}
.dshgit-caret{font-size:9px;opacity:.75}
.dshgit-branch-desc{font-size:11px;color:var(--dsw-alias-label-secondary,#9aa0a6);word-break:break-all;line-height:1.5;min-width:0;flex:1}
.dshgit-dropdown{position:absolute;top:26px;left:0;z-index:10;min-width:220px;max-width:320px;max-height:260px;overflow-y:auto;background:var(--dsw-alias-bg-overlay,#26272b);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.4);padding:4px}
.dshgit-drop-item{display:flex;align-items:center;gap:6px;width:100%;padding:5px 8px;border:none;border-radius:5px;background:none;cursor:pointer;color:var(--dsw-alias-label-primary,#e6e8eb);font-size:12px;text-align:left;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
.dshgit-drop-item:hover{background:rgba(127,127,127,.15)}
.dshgit-drop-item.active{color:var(--dsw-alias-brand-primary,#7aa5ff);font-weight:600}
.dshgit-drop-item.remote{opacity:.8}
.dshgit-drop-tag{font-size:9px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.2));border-radius:4px;padding:0 4px;color:var(--dsw-alias-label-secondary,#9aa0a6);margin-left:auto;flex-shrink:0}
.dshgit-rootpath{font-size:11px;color:var(--dsw-alias-label-secondary,#9aa0a6);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshgit-warn{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px;padding:7px 9px;border:1px solid var(--dsw-alias-state-warn-primary,#e5a50a);border-radius:7px;background:rgba(229,165,10,.08);font-size:11.5px;color:var(--dsw-alias-state-warn-primary,#e5a50a)}
.dshgit-warnbtns{display:flex;gap:6px;margin-left:auto}
.dshgit-toolbar{display:flex;gap:6px;padding:8px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));flex-wrap:wrap}
.dshgit-btn{background:var(--dsw-alias-bg-overlay,#26272b);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));color:var(--dsw-alias-label-primary,#e6e8eb);border-radius:6px;padding:4px 11px;font-size:12px;cursor:pointer}
.dshgit-btn:hover:not(:disabled){background:rgba(127,127,127,.18)}
.dshgit-btn:disabled{opacity:.45;cursor:default}
.dshgit-btn-primary{background:var(--dsw-alias-brand-primary,#4c8dff);border-color:transparent;color:#fff;font-weight:600}
.dshgit-btn-danger{border-color:var(--dsw-alias-state-warn-primary,#e5a50a);color:var(--dsw-alias-state-warn-primary,#e5a50a)}
.dshgit-btn-gen{border-color:var(--dsw-alias-brand-primary,#4c8dff);color:var(--dsw-alias-brand-primary,#7aa5ff)}
.dshgit-files{flex:1;overflow-y:auto;min-height:0}
.dshgit-section-title{padding:6px 14px 2px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#9aa0a6)}
.dshgit-file{display:flex;align-items:center;gap:8px;width:100%;padding:4px 14px;background:none;border:none;cursor:pointer;color:var(--dsw-alias-label-primary,#e6e8eb);text-align:left}
.dshgit-file:hover{background:rgba(127,127,127,.12)}
.dshgit-file.staged{opacity:.82}
.dshgit-badge{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:18px;border-radius:4px;font-size:10.5px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(127,127,127,.22);color:var(--dsw-alias-label-secondary,#c8ccd2)}
.dshgit-badge.M{color:var(--dsw-alias-state-warn-primary,#e5a50a)}
.dshgit-badge.A{color:var(--dsw-alias-state-success-primary,#3fb950)}
.dshgit-badge.D{color:var(--dsw-alias-state-error-primary,#f85149)}
.dshgit-badge.R,.dshgit-badge.C{color:var(--dsw-alias-brand-primary,#7aa5ff)}
.dshgit-badge.U{color:var(--dsw-alias-state-error-primary,#f85149)}
.dshgit-filepath{font-size:12.5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.dshgit-nofiles{padding:18px 14px;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa0a6)}
.dshgit-commitbox{border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));padding:10px 14px;display:flex;flex-direction:column;gap:8px}
.dshgit-msg{width:100%;box-sizing:border-box;min-height:74px;resize:vertical;background:var(--dsw-alias-bg-base,#141518);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:8px;color:var(--dsw-alias-label-primary,#e6e8eb);font-size:13px;font-family:inherit;padding:8px 10px;outline:none}
.dshgit-msg:focus{border-color:var(--dsw-alias-brand-primary,#4c8dff)}
.dshgit-genrow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dshgit-genrow label{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#9aa0a6);cursor:pointer}
.dshgit-actions{display:flex;gap:6px;align-items:center}
.dshgit-actions .dshgit-btn{flex:1;padding:6px 8px;font-size:12.5px}
.dshgit-status{font-size:11.5px;line-height:1.45;word-break:break-word;max-height:72px;overflow-y:auto}
.dshgit-status.err{color:var(--dsw-alias-state-error-primary,#f85149)}
.dshgit-status.ok{color:var(--dsw-alias-state-success-primary,#3fb950)}
.dshgit-status.load{color:var(--dsw-alias-label-secondary,#9aa0a6)}
.dshgit-toggle{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;border:none;background:none;color:var(--dsw-alias-label-secondary,#9aa0a6);cursor:pointer}
.dshgit-toggle:hover{background:rgba(127,127,127,.15);color:var(--dsw-alias-label-primary,#e6e8eb)}
.dshgit-toggle.active{color:var(--dsw-alias-brand-primary,#7aa5ff);background:rgba(76,141,255,.15)}
`;
      ctx.effect(() => {
        document.head.append(tag);
        return () => tag.remove();
      }, "dsh-git-sidebar: styles");

      const slots = ctx.get("slots");
      if (slots === undefined) return;

      slots.inject(
        "shell.overlay",
        () =>
          slots.register(
            { name: "shell.overlay", id: "dsh-git-sidebar", order: 300, label: "Git 面板" },
            () =>
              react.createElement(
                "div",
                { className: "dshgit-layer" },
                react.createElement(FabButton, null),
                react.createElement(GitPanel, ctx)
              )
          )
      );
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});