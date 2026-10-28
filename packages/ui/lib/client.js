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
var import_react2 = require("react");

// src/presentation.tsx
var import_react = require("react");

// src/contract.ts
var import_zod = require("zod");
var PROJECTION = "modelSpokesperson";
var RouteSchema = import_zod.z.object({ provider: import_zod.z.string().min(1), model: import_zod.z.string().min(1) });
var RuleSchema = import_zod.z.object({ source: RouteSchema, writer: RouteSchema });
var SettingsSchema = import_zod.z.object({
  enabled: import_zod.z.boolean().default(false),
  rules: import_zod.z.array(RuleSchema).default([]),
  style: import_zod.z.string().max(4e3).default("\u4E2D\u6587\uFF0C\u7ED3\u8BBA\u5148\u884C\uFF0C\u5C11\u672F\u8BED\uFF0C\u5FE0\u5B9E\u4E8E\u539F\u6587\u3002"),
  timeoutMs: import_zod.z.number().int().min(1).max(3e5).default(45e3),
  maxConcurrentRewrites: import_zod.z.number().int().min(1).max(16).default(2),
  maxInputChars: import_zod.z.number().int().min(1).max(2e5).default(3e4),
  maxOutputTokens: import_zod.z.number().int().min(1).max(32768).default(8192)
}).superRefine((config, ctx) => {
  const seen = /* @__PURE__ */ new Set();
  config.rules.forEach((rule, index) => {
    const key = JSON.stringify(rule.source);
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["rules", index], message: "\u540C\u4E00\u6765\u6E90\u8DEF\u7531\u53EA\u80FD\u914D\u7F6E\u4E00\u6B21" });
    seen.add(key);
  });
  if (config.enabled && config.rules.length === 0) ctx.addIssue({ code: "custom", path: ["rules"], message: "\u542F\u7528\u65F6\u81F3\u5C11\u914D\u7F6E\u4E00\u4E2A\u6765\u6E90\u6A21\u578B" });
});
var RewriteSchema = import_zod.z.object({
  schemaVersion: import_zod.z.literal(1),
  policyVersion: import_zod.z.literal(1),
  promptVersion: import_zod.z.literal(1),
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
  request: import_zod.z.object({ system: import_zod.z.string(), input: import_zod.z.string() }).optional()
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
  const text = data.blocks.flatMap((block) => block.kind === "text" ? [block.text] : []).join("");
  if (data.status === "interrupted" || data.blocks.some((block) => block.kind === "tool-call")) return "original";
  if (row.status === "collecting") return "pending";
  if (data.status !== "running" && (row.originalMessageId !== data.finalNode?.messageId || row.originalText !== text)) return "original";
  if (row.status === "rewriting") return "pending";
  if (row.status === "ready" && row.rewrittenText) return "ready";
  if (row.status === "fallback" || row.status === "cancelled") return "fallback";
  return "original";
}
function createAssistantView(Default) {
  return function SpokespersonAssistant(props) {
    const [copyState, setCopyState] = (0, import_react.useState)("\u590D\u5236\u6574\u7406\u7A3F");
    const rows = props.useProjection(PROJECTION);
    const row = rows?.[stepKey(props.node.data.turn, props.node.data.step)];
    const mode = presentation(row, props);
    if (props.groupPart === "reasoning" || mode === "original") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Default, { ...props });
    const data = props.node.data;
    if (mode === "pending") {
      const withoutText = { ...props.node, data: { ...data, blocks: data.blocks.filter((block) => block.kind !== "text") } };
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Default, { ...props, node: withoutText }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { role: "status", "aria-live": "polite", style: hint, children: "\u6B63\u5728\u6574\u7406\u8868\u8FBE\u2026" })
      ] });
    }
    if (mode === "fallback") return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Default, { ...props }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { role: "status", style: hint, children: "\u6574\u7406\u672A\u5B8C\u6210\uFF0C\u5DF2\u663E\u793A\u539F\u6587\u3002" })
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
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "\u6587\u5B57\u5DF2\u6574\u7406" }),
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

// src/client.ts
var inject = ["slots"];
var children = {
  "conversation.chat.reasoning.body": "model-spokesperson.reasoning.body",
  "conversation.chat.message.images": "model-spokesperson.message.images"
};
function apply(ctx) {
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
      const Delegate = (props) => (0, import_react2.createElement)(Default, {
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
