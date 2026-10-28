window.__ModuleLoader__.load({id:"@dsh-plugins/model-spokesperson-ui",factory:(require)=>{const module={exports:{}};const exports=module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.ts
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react4 = require("react");

// src/presentation.tsx
var import_react = require("react");

// src/contract.ts
var import_zod = require("zod");
var PROJECTION = "modelSpokesperson";
var SETTINGS_NS = "model-spokesperson-host";
var RouteSchema = import_zod.z.object({ provider: import_zod.z.string().min(1), model: import_zod.z.string().min(1) });
var RuleSchema = import_zod.z.object({ source: RouteSchema, writer: RouteSchema });
var SettingsSchema = import_zod.z.object({
  enabled: import_zod.z.boolean().default(false),
  rules: import_zod.z.array(RuleSchema).default([]),
  style: import_zod.z.string().max(4e3).default("\u4E2D\u6587\uFF0C\u7ED3\u8BBA\u5148\u884C\uFF0C\u5C11\u672F\u8BED\uFF0C\u6E05\u695A\u81EA\u7136\uFF0C\u4E8B\u5B9E\u51C6\u786E\u3002"),
  reviewRounds: import_zod.z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(1),
  timeoutMs: import_zod.z.number().int().min(0).max(2147483647).default(0),
  maxConcurrentRewrites: import_zod.z.number().int().min(1).max(16).default(2),
  maxInputChars: import_zod.z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  maxOutputTokens: import_zod.z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0)
}).superRefine((config, ctx) => {
  const seen = /* @__PURE__ */ new Set();
  config.rules.forEach((rule, index) => {
    const key = JSON.stringify(rule.source);
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["rules", index], message: "\u540C\u4E00\u6765\u6E90\u8DEF\u7531\u53EA\u80FD\u914D\u7F6E\u4E00\u6B21" });
    seen.add(key);
  });
  if (config.enabled && config.rules.length === 0) ctx.addIssue({ code: "custom", path: ["rules"], message: "\u542F\u7528\u65F6\u81F3\u5C11\u914D\u7F6E\u4E00\u4E2A\u6765\u6E90\u6A21\u578B" });
});
var ReportStageSchema = import_zod.z.object({
  kind: import_zod.z.enum(["draft", "review"]),
  round: import_zod.z.number().int().min(0),
  system: import_zod.z.string(),
  input: import_zod.z.string(),
  startedAt: import_zod.z.number(),
  output: import_zod.z.string().optional(),
  usage: import_zod.z.unknown().optional(),
  finishedAt: import_zod.z.number().optional()
});
var RewriteSchema = import_zod.z.object({
  schemaVersion: import_zod.z.literal(1),
  policyVersion: import_zod.z.union([import_zod.z.literal(1), import_zod.z.literal(2)]),
  promptVersion: import_zod.z.union([import_zod.z.literal(1), import_zod.z.literal(2)]),
  sessionId: import_zod.z.string(),
  turn: import_zod.z.number().int(),
  step: import_zod.z.number().int(),
  attemptId: import_zod.z.string(),
  source: RouteSchema,
  writer: RouteSchema,
  status: import_zod.z.enum(["collecting", "rewriting", "ready", "bypass", "fallback", "cancelled"]),
  originalMessageId: import_zod.z.string().optional(),
  sourceHash: import_zod.z.string().optional(),
  originalText: import_zod.z.string().optional(),
  rewrittenText: import_zod.z.string().optional(),
  reason: import_zod.z.string().optional(),
  startedAt: import_zod.z.number(),
  finishedAt: import_zod.z.number().optional(),
  usage: import_zod.z.unknown().optional(),
  request: import_zod.z.object({ system: import_zod.z.string(), input: import_zod.z.string() }).optional(),
  phase: import_zod.z.enum(["drafting", "reviewing"]).optional(),
  reviewRound: import_zod.z.number().int().min(0).optional(),
  reviewRounds: import_zod.z.number().int().min(0).optional(),
  stages: import_zod.z.array(ReportStageSchema).optional()
});
var ProjectionSchema = import_zod.z.record(import_zod.z.string(), RewriteSchema);
var StateSchema = import_zod.z.object({ rows: ProjectionSchema, latestUser: import_zod.z.string(), synced: import_zod.z.array(import_zod.z.string()) });
var stepKey = (turn, step) => `${turn}:${step}`;

// src/presentation.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var hint = { fontFamily: "system-ui, sans-serif", fontSize: 12, color: "var(--dsw-alias-label-secondary, #64748b)", marginTop: 8 };
function presentation(row, props) {
  const data = props.node.data;
  if (!row || row.turn !== data.turn || row.step !== data.step) return "original";
  const text2 = data.blocks.flatMap((block) => block.kind === "text" ? [block.text] : []).join("");
  if (data.status === "interrupted" || data.blocks.some((block) => block.kind === "tool-call")) return "original";
  if (row.status === "collecting") return "pending";
  if (data.status !== "running" && (row.originalMessageId !== data.finalNode?.messageId || row.originalText !== text2)) return "original";
  if (row.status === "rewriting") return "pending";
  if (row.status === "ready" && row.rewrittenText) return "ready";
  if (row.status === "fallback" || row.status === "cancelled") return "fallback";
  return "original";
}
function createAssistantView(Default) {
  return function SpokespersonAssistant(props) {
    const [copyState, setCopyState] = (0, import_react.useState)("\u590D\u5236 B \u56DE\u590D");
    const rows = props.useProjection(PROJECTION);
    const row = rows?.[stepKey(props.node.data.turn, props.node.data.step)];
    const mode = presentation(row, props);
    if (props.groupPart === "reasoning" || mode === "original") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Default, { ...props });
    const data = props.node.data;
    if (mode === "pending") {
      const withoutText = { ...props.node, data: { ...data, blocks: data.blocks.filter((block) => block.kind !== "text") } };
      const progress = row?.policyVersion === 2 ? row.status === "collecting" ? "\u7B49\u5F85 A \u5B8C\u6210\u56DE\u590D\u2026" : row.phase === "reviewing" ? `B \u6B63\u5728\u6838\u5BF9\u5B8C\u5584\uFF08${row.reviewRound}/${row.reviewRounds}\uFF09\u2026` : "B \u6B63\u5728\u72EC\u7ACB\u8D77\u8349\u2026" : "\u6B63\u5728\u6574\u7406\u8868\u8FBE\u2026";
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Default, { ...props, node: withoutText }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { role: "status", "aria-live": "polite", style: hint, children: progress })
      ] });
    }
    if (mode === "fallback") return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Default, { ...props }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { role: "status", style: hint, children: row?.policyVersion === 2 ? "B \u56DE\u590D\u672A\u5B8C\u6210\uFF0C\u5DF2\u663E\u793A A \u539F\u6587\u3002" : "\u6574\u7406\u672A\u5B8C\u6210\uFF0C\u5DF2\u663E\u793A\u539F\u6587\u3002" })
    ] });
    let inserted = false;
    const blocks = data.blocks.flatMap((block) => {
      if (block.kind !== "text") return [block];
      if (inserted) return [];
      inserted = true;
      return [{ ...block, text: row.rewrittenText }];
    });
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { "data-model-spokesperson": "ready", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Default, { ...props, node: { ...props.node, data: { ...data, blocks } } }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { ...hint, display: "flex", alignItems: "center", gap: 10 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: row.policyVersion === 2 ? `B \u5DF2\u72EC\u7ACB\u4F5C\u7B54${row.reviewRounds ? ` \xB7 \u5DF2\u6838\u5BF9 ${row.reviewRounds} \u8F6E` : ""}` : "\u6587\u5B57\u5DF2\u6574\u7406" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            style: { font: "inherit", color: "inherit", background: "transparent", border: "1px solid var(--dsw-alias-border-l1, #cbd5e1)", borderRadius: 6, padding: "3px 8px", cursor: "pointer" },
            onClick: () => {
              try {
                void navigator.clipboard.writeText(row.rewrittenText).then(() => setCopyState("\u5DF2\u590D\u5236"), () => setCopyState("\u590D\u5236\u5931\u8D25"));
              } catch {
                setCopyState("\u590D\u5236\u5931\u8D25");
              }
            },
            children: copyState
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { style: hint, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { style: { cursor: "pointer" }, children: "\u67E5\u770B A \u7684\u539F\u6587" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Default, { ...props, groupPart: "response" })
      ] })
    ] });
  };
}

// src/settings-client.ts
var import_react3 = require("react");

// src/settings-view.tsx
var import_react2 = require("react");
var import_jsx_runtime2 = require("react/jsx-runtime");
var keyOf = (route) => route.provider && route.model ? JSON.stringify([route.provider, route.model]) : "";
var fromKey = (key) => key ? { provider: JSON.parse(key)[0], model: JSON.parse(key)[1] } : { provider: "", model: "" };
var text = { fontFamily: "system-ui, sans-serif", fontSize: 13, lineHeight: 1.6, color: "var(--dsw-alias-label-primary, #1e293b)" };
var control = { font: "inherit", color: "inherit", background: "var(--dsw-alias-background-primary, transparent)", border: "1px solid var(--dsw-alias-border-l1, #cbd5e1)", borderRadius: 8, padding: "8px 10px", width: "100%", boxSizing: "border-box" };
var button = { ...control, width: "auto", cursor: "pointer" };
var note = { color: "var(--dsw-alias-label-secondary, #64748b)", margin: "4px 0 12px" };
function settingsError(value) {
  const result = SettingsSchema.safeParse(value);
  if (result.success) return;
  const issue = result.error.issues[0];
  if (issue.path[0] === "rules") return value.rules.some((rule) => !keyOf(rule.source) || !keyOf(rule.writer)) ? "\u8BF7\u4E3A\u6BCF\u7EC4\u6620\u5C04\u9009\u62E9\u5B8C\u6574\u7684 A \u548C B \u6A21\u578B\u3002" : issue.message;
  return issue.path[0] === "style" ? "\u8868\u8FBE\u504F\u597D\u4E0D\u80FD\u8D85\u8FC7 4000 \u5B57\u3002" : "\u8BF7\u68C0\u67E5\u9AD8\u7EA7\u8BBE\u7F6E\u7684\u6570\u503C\u8303\u56F4\u3002";
}
function SettingsView({ form, loadCatalog }) {
  const subscribe = (0, import_react2.useCallback)((listener) => form.subscribe(listener), [form]);
  const getSnapshot = (0, import_react2.useCallback)(() => form.getSnapshot(), [form]);
  const snapshot = (0, import_react2.useSyncExternalStore)(subscribe, getSnapshot);
  const current = (0, import_react2.useMemo)(() => SettingsSchema.parse(snapshot.value ?? {}), [snapshot.value]);
  const [draft, setDraft] = (0, import_react2.useState)();
  const [saving, setSaving] = (0, import_react2.useState)(false);
  const [message, setMessage] = (0, import_react2.useState)("");
  const [error, setError] = (0, import_react2.useState)("");
  const [catalog, setCatalog] = (0, import_react2.useState)();
  const [catalogStatus, setCatalogStatus] = (0, import_react2.useState)("loading");
  const [refresh, setRefresh] = (0, import_react2.useState)(0);
  const alive = (0, import_react2.useRef)(true);
  (0, import_react2.useEffect)(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  (0, import_react2.useEffect)(() => {
    let active = true;
    setCatalogStatus("loading");
    void Promise.resolve().then(loadCatalog).then((value2) => {
      if (active) {
        setCatalog(value2);
        setCatalogStatus("ready");
      }
    }, () => {
      if (active) setCatalogStatus("error");
    });
    return () => {
      active = false;
    };
  }, [loadCatalog, refresh]);
  const value = draft?.settings ?? current;
  const dirty = JSON.stringify(value) !== JSON.stringify(current);
  const conflict = dirty && draft?.revision !== snapshot.revision;
  const invalid = settingsError(value);
  const writable = snapshot.status === "ready" && snapshot.writable && !saving;
  function edit(change) {
    setDraft((previous) => ({ settings: change(previous?.settings ?? structuredClone(current)), revision: previous ? previous.revision : snapshot.revision }));
    setMessage("");
    setError("");
  }
  async function save(event) {
    event.preventDefault();
    if (!writable || !dirty || !draft || invalid || conflict) return;
    const desired = SettingsSchema.parse(value);
    const ops = Object.keys(desired).filter((key) => JSON.stringify(desired[key]) !== JSON.stringify(current[key])).map((key) => ({ op: "set", path: [key], value: desired[key] }));
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const accepted = await form.mutate(ops, draft.revision);
      if (!alive.current) return;
      if (accepted) {
        setDraft(void 0);
        setMessage("\u5DF2\u4FDD\u5B58\uFF0C\u4E0B\u4E00\u6B21\u56DE\u590D\u5C06\u4F7F\u7528\u65B0\u8BBE\u7F6E\u3002");
      } else setError("\u4FDD\u5B58\u672A\u6210\u529F\uFF0C\u4FEE\u6539\u4ECD\u5DF2\u4FDD\u7559\u3002\u8BF7\u68C0\u67E5\u662F\u5426\u6709\u5176\u4ED6\u9875\u9762\u6216\u914D\u7F6E\u6587\u4EF6\u540C\u65F6\u66F4\u65B0\u3002");
    } catch {
      if (alive.current) setError("\u4FDD\u5B58\u5931\u8D25\uFF0C\u4FEE\u6539\u4ECD\u5DF2\u4FDD\u7559\u3002\u8BF7\u68C0\u67E5\u8FDE\u63A5\u540E\u91CD\u8BD5\u3002");
    } finally {
      if (alive.current) setSaving(false);
    }
  }
  if (snapshot.status !== "ready") return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "status", style: text, children: snapshot.status === "loading" ? "\u6B63\u5728\u8BFB\u53D6\u6A21\u578B\u5634\u66FF\u8BBE\u7F6E\u2026" : "\u914D\u7F6E\u6682\u4E0D\u53EF\u7528\uFF0C\u8BF7\u786E\u8BA4 Host \u7EC4\u4EF6\u5DF2\u542F\u7528\u3002" });
  const groups = catalog?.groups ?? [];
  function selector(route, label, change) {
    const found = groups.some((group) => group.id === route.provider && group.models.some((model) => model.id === route.model));
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { style: { display: "grid", gap: 5 }, children: [
      label,
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { "aria-label": label, style: control, value: keyOf(route), onChange: (event) => change(fromKey(event.target.value)), children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "", children: "\u8BF7\u9009\u62E9\u6A21\u578B" }),
        keyOf(route) && !found && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("option", { value: keyOf(route), children: [
          route.provider,
          " / ",
          route.model,
          "\uFF08\u5F53\u524D\u4E0D\u5728\u6A21\u578B\u5217\u8868\u4E2D\uFF09"
        ] }),
        groups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("optgroup", { label: `${group.name} \xB7 ${group.id}`, children: group.models.map((model) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("option", { value: keyOf({ provider: group.id, model: model.id }), children: [
          group.name,
          " / ",
          model.name,
          model.name !== model.id ? ` \xB7 ${model.id}` : ""
        ] }, model.id)) }, group.id))
      ] })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("form", { "aria-label": "\u6A21\u578B\u5634\u66FF\u8BBE\u7F6E", noValidate: true, onSubmit: (event) => void save(event), style: { ...text, padding: "18px 0", display: "grid", gap: 16 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { style: { margin: 0, fontSize: 16 }, children: "\u6A21\u578B\u4E0E\u8868\u8FBE" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: note, children: "A \u8D1F\u8D23\u5206\u6790\u548C\u6267\u884C\uFF0CB \u6839\u636E\u5DE5\u4F5C\u4E0A\u4E0B\u6587\u72EC\u7ACB\u4F5C\u7B54\uFF0C\u518D\u53C2\u8003 A \u7684\u62A5\u544A\u6838\u5BF9\u81EA\u5DF1\u7684\u521D\u7A3F\u3002" })
    ] }),
    !snapshot.writable && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "status", style: note, children: "\u5F53\u524D\u90E8\u7F72\u7684\u914D\u7F6E\u4E3A\u53EA\u8BFB\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("fieldset", { disabled: !writable, style: { border: 0, padding: 0, margin: 0, minWidth: 0, display: "grid", gap: 16 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { type: "checkbox", checked: value.enabled, onChange: (event) => edit((settings) => ({ ...settings, enabled: event.target.checked })) }),
        "\u5F00\u542F B \u56DE\u590D"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: note, children: [
          catalogStatus === "loading" ? "\u6B63\u5728\u8BFB\u53D6\u6A21\u578B\u5217\u8868\u2026" : catalogStatus === "error" ? "\u6A21\u578B\u5217\u8868\u8BFB\u53D6\u5931\u8D25\uFF0C\u5DF2\u4FDD\u7559\u5F53\u524D\u914D\u7F6E\u3002" : groups.length === 0 ? "\u6CA1\u6709\u53EF\u9009\u6A21\u578B\uFF0C\u8BF7\u5148\u5728 DSH \u7684\u201C\u8BBE\u7F6E \u2192 \u6A21\u578B\u201D\u4E2D\u914D\u7F6E\u3002" : "\u4ECE DSH \u5DF2\u914D\u7F6E\u7684\u6A21\u578B\u4E2D\u9009\u62E9\u3002",
          catalog?.failures.length ? " \u90E8\u5206\u63D0\u4F9B\u65B9\u6682\u65F6\u4E0D\u53EF\u7528\uFF0C\u5DF2\u6709\u9009\u62E9\u4E0D\u4F1A\u88AB\u6E05\u9664\u3002" : ""
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: button, onClick: () => setRefresh((value2) => value2 + 1), disabled: catalogStatus === "loading", children: "\u5237\u65B0\u6A21\u578B\u5217\u8868" })
      ] }),
      value.rules.map((rule, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("fieldset", { style: { border: "1px solid var(--dsw-alias-border-l1, #e2e8f0)", borderRadius: 10, padding: 14, margin: 0, minWidth: 0 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("legend", { children: [
          "\u6A21\u578B\u6620\u5C04 ",
          index + 1
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }, children: [
          selector(rule.source, `\u7B2C ${index + 1} \u7EC4 A \u6A21\u578B\uFF08\u5B8C\u6210\u5DE5\u4F5C\uFF09`, (route) => edit((settings) => ({ ...settings, rules: settings.rules.map((item, i) => i === index ? { ...item, source: route } : item) }))),
          selector(rule.writer, `\u7B2C ${index + 1} \u7EC4 B \u6A21\u578B\uFF08\u72EC\u7ACB\u4F5C\u7B54\uFF09`, (route) => edit((settings) => ({ ...settings, rules: settings.rules.map((item, i) => i === index ? { ...item, writer: route } : item) })))
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", style: { ...button, marginTop: 12 }, onClick: () => edit((settings) => ({ ...settings, rules: settings.rules.filter((_, i) => i !== index) })), children: [
          "\u5220\u9664\u7B2C ",
          index + 1,
          " \u7EC4\u6620\u5C04"
        ] })
      ] }, index)),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: button, onClick: () => edit((settings) => ({ ...settings, rules: [...settings.rules, { source: { provider: "", model: "" }, writer: { provider: "", model: "" } }] })), children: "\u6DFB\u52A0\u6A21\u578B\u6620\u5C04" }) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { style: { display: "grid", gap: 5 }, children: [
        "\u8868\u8FBE\u504F\u597D",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("textarea", { "aria-label": "\u8868\u8FBE\u504F\u597D", rows: 3, style: control, value: value.style, onChange: (event) => edit((settings) => ({ ...settings, style: event.target.value })) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { style: { display: "grid", gap: 5 }, children: [
        "\u6838\u5BF9\u8F6E\u6570",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { "aria-label": "\u6838\u5BF9\u8F6E\u6570", type: "number", min: 0, step: 1, style: control, value: value.reviewRounds, onChange: (event) => edit((settings) => ({ ...settings, reviewRounds: Number(event.target.value) })) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: note, children: [
          "\u5148\u72EC\u7ACB\u8D77\u8349\uFF0C\u518D\u6838\u5BF9 ",
          value.reviewRounds,
          " \u8F6E\uFF0C\u5171\u8C03\u7528 B ",
          value.reviewRounds + 1,
          " \u6B21\u3002\u8BBE\u4E3A 0 \u65F6\u53EA\u72EC\u7ACB\u8D77\u8349\uFF0C\u4E0D\u5411 B \u63D0\u4F9B A \u672C\u6B21\u62A5\u544A\u3002\u6BCF\u8F6E\u6838\u5BF9\u90FD\u5728 B \u81EA\u5DF1\u7684\u4E0A\u4E00\u7A3F\u4E0A\u5B8C\u5584\u3002"
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { style: { cursor: "pointer" }, children: "\u9AD8\u7EA7\u8BBE\u7F6E" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginTop: 12 }, children: [{ key: "timeoutMs", label: "\u5B8C\u6574\u6D41\u7A0B\u8D85\u65F6\uFF08\u79D2\uFF0C0 \u4E0D\u9650\uFF09", scale: 1e3, min: 0, max: 2147483647e-3 }, { key: "maxConcurrentRewrites", label: "\u540C\u65F6\u5904\u7406\u6570\u91CF", scale: 1, min: 1, max: 16 }, { key: "maxInputChars", label: "\u6BCF\u6B21\u8F93\u5165\u5B57\u7B26\u4E0A\u9650\uFF080 \u4E0D\u9650\uFF09", scale: 1, min: 0, max: Number.MAX_SAFE_INTEGER }, { key: "maxOutputTokens", label: "\u6BCF\u6B21\u8F93\u51FA tokens\uFF080 \u8DDF\u968F\u6A21\u578B\uFF09", scale: 1, min: 0, max: Number.MAX_SAFE_INTEGER }].map((field) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { style: { display: "grid", gap: 5 }, children: [
          field.label,
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { "aria-label": field.label, type: "number", step: field.key === "timeoutMs" ? "any" : 1, min: field.min, max: field.max, style: control, value: value[field.key] / field.scale, onChange: (event) => edit((settings) => ({ ...settings, [field.key]: Number(event.target.value) * field.scale })) })
        ] }, field.key)) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: note, children: "\u63D2\u4EF6\u9ED8\u8BA4\u4E0D\u989D\u5916\u9650\u5236\u8F93\u5165\u548C\u7B49\u5F85\u65F6\u95F4\uFF0C\u8F93\u51FA\u4E0A\u9650\u8DDF\u968F B \u7684\u6A21\u578B\u914D\u7F6E\uFF1B\u5B9E\u9645\u4ECD\u53D7\u6A21\u578B\u53CA\u63D0\u4F9B\u65B9\u9650\u5236\u3002\u65E7\u8BBE\u7F6E\u4E2D\u7684\u9650\u989D\u4F1A\u4FDD\u7559\uFF0C\u53EF\u6539\u4E3A 0\u3002\u6BCF\u6B21\u8F93\u5165\u5305\u542B\u5DE5\u4F5C\u4E0A\u4E0B\u6587\uFF0C\u6838\u5BF9\u65F6\u8FD8\u5305\u542B B \u7684\u4E0A\u4E00\u7A3F\u548C A \u7684\u62A5\u544A\uFF1B\u8D85\u8FC7\u81EA\u8BBE\u4E0A\u9650\u4F1A\u56DE\u9000\uFF0C\u4E0D\u4F1A\u9759\u9ED8\u622A\u65AD\u3002" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: note, children: "\u804A\u5929\u65F6\u4ECD\u5728\u8F93\u5165\u6846\u9009\u62E9 A\uFF0C\u8FD9\u91CC\u4E0D\u4F1A\u81EA\u52A8\u5207\u6362\u4F1A\u8BDD\u6A21\u578B\u3002\u4FDD\u5B58\u53EA\u5F71\u54CD\u540E\u7EED\u56DE\u590D\uFF0C\u8FDB\u884C\u4E2D\u7684\u6D41\u7A0B\u4FDD\u7559\u539F\u8BBE\u7F6E\u3002B \u4F1A\u589E\u52A0\u8C03\u7528\u8D39\u7528\u548C\u7B49\u5F85\u65F6\u95F4\uFF1B\u6838\u5BF9\u5931\u8D25\u4F1A\u663E\u793A A \u539F\u6587\u3002\u6CA1\u6709\u5339\u914D\u5230 A \u7684\u6A21\u578B\u76F4\u63A5\u663E\u793A\u3002" }),
    invalid && dirty && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "alert", style: { margin: 0, color: "var(--dsw-alias-state-error-primary, #b91c1c)" }, children: invalid }),
    conflict && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "alert", children: "\u8BBE\u7F6E\u5DF2\u5728\u5176\u4ED6\u9875\u9762\u6216\u914D\u7F6E\u6587\u4EF6\u4E2D\u6539\u53D8\u3002\u8BF7\u5148\u653E\u5F03\u5F53\u524D\u4FEE\u6539\uFF0C\u8BFB\u53D6\u6700\u65B0\u503C\u540E\u518D\u4FDD\u5B58\u3002" }),
    error && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "alert", children: error }),
    message && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "status", style: { margin: 0 }, children: message }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", gap: 10 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "submit", style: { ...button, background: "var(--dsw-alias-fill-brand-primary, #2563eb)", color: "#fff", opacity: !writable || !dirty || !!invalid || conflict ? 0.5 : 1 }, disabled: !writable || !dirty || !!invalid || conflict, children: saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u8BBE\u7F6E" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: { ...button, opacity: !dirty || saving ? 0.5 : 1 }, disabled: !dirty || saving, onClick: () => {
        setDraft(void 0);
        setMessage("");
        setError("");
      }, children: "\u653E\u5F03\u4FEE\u6539" })
    ] })
  ] });
}

// src/settings-client.ts
function mountSettings(ctx) {
  const form = ctx.configForms.get(SETTINGS_NS);
  const loadCatalog = async () => {
    const result = await ctx.remote.session.modelCatalog();
    if (!result.ok) throw new Error("\u6A21\u578B\u5217\u8868\u6682\u4E0D\u53EF\u7528");
    return result.value;
  };
  ctx.effect(() => ctx.configForms.whileServed([SETTINGS_NS], () => ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
    name: "plugins.bundle.config",
    key: "@dsh-plugins/model-spokesperson"
  }, () => (0, import_react3.createElement)(SettingsView, { form, loadCatalog })))));
}

// src/client.ts
var inject = ["slots"];
var children = {
  "conversation.chat.reasoning.body": "model-spokesperson.reasoning.body",
  "conversation.chat.message.images": "model-spokesperson.message.images"
};
function apply(ctx) {
  ctx.inject(["configForms", "remote", "remote.session"], mountSettings);
  let own;
  let base;
  let changing = false;
  function reconcile() {
    if (changing) return;
    const original = ctx.slots.entries("conversation.chat.node").find((entry) => entry.options.key === "assistant-step" && entry.children?.["conversation.chat.reasoning.body"] && entry.children?.["conversation.chat.message.images"]);
    if (original === base) return;
    changing = true;
    try {
      own?.();
      own = void 0;
      base = original;
      if (!original) return;
      const Default = original.component;
      const Delegate = (props) => (0, import_react4.createElement)(Default, {
        ...props,
        renderSlot: (key, owner, options) => props.renderSlot(children[key], owner, options)
      });
      const View = createAssistantView(Delegate);
      const register = ctx.slots.register;
      const dispose = register.call(ctx.slots, {
        name: "conversation.chat.node",
        key: "assistant-step",
        priority: (original.options.priority ?? 0) - 10,
        locale: original.locale,
        inject: original.inject,
        children: Object.fromEntries(Object.entries(children).map(([source, target]) => [target, original.children[source]]))
      }, View);
      const mirrors = Object.entries(children).map(([source, target]) => {
        let entries;
        let undo = [];
        const sync = () => {
          const current = ctx.slots.entries(source);
          if (current === entries) return;
          for (const stop2 of undo) stop2();
          undo = [];
          entries = current;
          for (const entry of current) {
            if (entry.children) continue;
            undo.push(register.call(ctx.slots, {
              name: target,
              ...entry.options,
              locale: entry.locale,
              inject: entry.inject,
              store: entry.store,
              select: entry.select
            }, entry.component));
          }
        };
        const stop = ctx.slots.subscribe(source, sync);
        sync();
        return () => {
          stop();
          for (const remove of undo) remove();
        };
      });
      own = () => {
        for (const stop of mirrors) stop();
        dispose();
      };
    } finally {
      changing = false;
    }
  }
  ctx.effect(() => {
    const unsubscribe = ctx.slots.subscribe("conversation.chat.node", reconcile);
    reconcile();
    return () => {
      unsubscribe();
      own?.();
      base = void 0;
    };
  });
}
return module.exports;}});
//# sourceMappingURL=client.js.map
