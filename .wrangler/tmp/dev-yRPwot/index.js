var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-hk9ROd/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// src/index.ts
var src_default = {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return handleOptions();
    }
    const url = new URL(request.url);
    if (!url.pathname.endsWith("/v1/messages")) {
      return new Response("Not Found. URL must end with /v1/messages", { status: 404 });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    let effectiveApiKey = request.headers.get("x-api-key") || request.headers.get("anthropic-auth-token") || request.headers.get("Authorization")?.replace("Bearer ", "");
    if (!effectiveApiKey) {
      effectiveApiKey = env.HAIKU_API_KEY;
      console.log("Using fallback API key from environment");
    }
    console.log("API Key status:", effectiveApiKey ? "available" : "missing");
    try {
      const claudeRequest = await request.json();
      let targetApiKey = effectiveApiKey;
      let targetModelName;
      let targetBaseUrl;
      const isHaiku = claudeRequest.model.toLowerCase().includes("haiku");
      if (isHaiku) {
        targetModelName = env.HAIKU_MODEL_NAME;
        targetBaseUrl = env.HAIKU_BASE_URL;
        targetApiKey = env.HAIKU_API_KEY;
      } else {
        const dynamicConfig = parsePathAndModel(url.pathname);
        if (dynamicConfig) {
          targetBaseUrl = dynamicConfig.baseUrl;
          targetModelName = dynamicConfig.modelName;
        } else {
          return new Response(JSON.stringify({ error: 'The "url" is missing.' }), {
            status: 401,
            headers: { "Content-Type": "application/json" }
          });
        }
      }
      if (!targetBaseUrl || !targetModelName) {
        return new Response(JSON.stringify({ error: "Could not determine target base URL or model name. Ensure the URL format is correct or fallback environment variables are set." }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders() }
        });
      }
      const target = {
        modelName: targetModelName,
        baseUrl: targetBaseUrl,
        apiKey: targetApiKey
      };
      const openaiRequest = convertClaudeToOpenAIRequest(claudeRequest, target.modelName);
      const openaiApiResponse = await fetch(`${target.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${target.apiKey}`
        },
        body: JSON.stringify(openaiRequest)
      });
      if (!openaiApiResponse.ok) {
        const errorBody = await openaiApiResponse.text();
        return new Response(errorBody, {
          status: openaiApiResponse.status,
          statusText: openaiApiResponse.statusText,
          headers: { "Content-Type": "application/json", ...corsHeaders() }
        });
      }
      if (claudeRequest.stream) {
        const transformStream = new TransformStream({
          transform: streamTransformer(claudeRequest.model)
        });
        return new Response(openaiApiResponse.body.pipeThrough(transformStream), {
          headers: { "Content-Type": "text/event-stream", ...corsHeaders() }
        });
      } else {
        const openaiResponse = await openaiApiResponse.json();
        const claudeResponse = convertOpenAIToClaudeResponse(openaiResponse, claudeRequest.model);
        return new Response(JSON.stringify(claudeResponse), {
          headers: { "Content-Type": "application/json", ...corsHeaders() }
        });
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    }
  }
};
function parsePathAndModel(pathname) {
  const dynamicPath = pathname.substring(0, pathname.lastIndexOf("/v1/messages"));
  const parts = dynamicPath.split("/").filter((p) => p);
  if (parts.length < 2) {
    return null;
  }
  const modelName = parts.pop();
  let baseUrl;
  if (parts[0].toLowerCase() === "http" || parts[0].toLowerCase() === "https") {
    const scheme = parts.shift();
    baseUrl = `${scheme}://${parts.join("/")}`;
  } else {
    baseUrl = `https://${parts.join("/")}`;
  }
  return { baseUrl, modelName };
}
__name(parsePathAndModel, "parsePathAndModel");
function recursivelyCleanSchema(schema) {
  if (schema === null || typeof schema !== "object") {
    return schema;
  }
  if (Array.isArray(schema)) {
    return schema.map((item) => recursivelyCleanSchema(item));
  }
  const newSchema = {};
  for (const key in schema) {
    if (Object.prototype.hasOwnProperty.call(schema, key)) {
      if (key === "$schema" || key === "additionalProperties") {
        continue;
      }
      newSchema[key] = recursivelyCleanSchema(schema[key]);
    }
  }
  if (newSchema.type === "string" && newSchema.format) {
    const supportedFormats = ["date-time", "enum"];
    if (!supportedFormats.includes(newSchema.format)) {
      delete newSchema.format;
    }
  }
  return newSchema;
}
__name(recursivelyCleanSchema, "recursivelyCleanSchema");
function convertClaudeToOpenAIRequest(claudeRequest, modelName) {
  const openaiMessages = [];
  if (claudeRequest.system) {
    openaiMessages.push({ role: "system", content: claudeRequest.system });
  }
  for (let i = 0; i < claudeRequest.messages.length; i++) {
    const message = claudeRequest.messages[i];
    if (message.role === "user") {
      if (Array.isArray(message.content)) {
        const toolResults = message.content.filter((c) => c.type === "tool_result");
        const otherContent = message.content.filter((c) => c.type !== "tool_result");
        if (toolResults.length > 0) {
          toolResults.forEach((block) => {
            openaiMessages.push({
              role: "tool",
              tool_call_id: block.tool_use_id,
              content: typeof block.content === "string" ? block.content : JSON.stringify(block.content)
            });
          });
        }
        if (otherContent.length > 0) {
          openaiMessages.push({ role: "user", content: otherContent.map((block) => block.type === "text" ? { type: "text", text: block.text } : { type: "image_url", image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } }) });
        }
      } else {
        openaiMessages.push({ role: "user", content: message.content });
      }
    } else if (message.role === "assistant") {
      const textParts = [];
      const toolCalls = [];
      if (Array.isArray(message.content)) {
        message.content.forEach((block) => {
          if (block.type === "text") {
            textParts.push(block.text);
          } else if (block.type === "tool_use") {
            toolCalls.push({
              id: block.id,
              type: "function",
              function: { name: block.name, arguments: JSON.stringify(block.input || {}) }
            });
          }
        });
      }
      const assistantMessage = { role: "assistant", content: textParts.join("\n") || null };
      if (toolCalls.length > 0) {
        assistantMessage.tool_calls = toolCalls;
      }
      openaiMessages.push(assistantMessage);
    }
  }
  const openaiRequest = {
    model: modelName,
    messages: openaiMessages,
    max_tokens: claudeRequest.max_tokens,
    temperature: claudeRequest.temperature,
    top_p: claudeRequest.top_p,
    stream: claudeRequest.stream,
    stop: claudeRequest.stop_sequences
  };
  if (claudeRequest.tools) {
    openaiRequest.tools = claudeRequest.tools.map((tool) => {
      const cleanedParameters = recursivelyCleanSchema(tool.input_schema);
      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: cleanedParameters
        }
      };
    });
  }
  if (claudeRequest.tool_choice) {
    if (claudeRequest.tool_choice.type === "auto" || claudeRequest.tool_choice.type === "any") {
      openaiRequest.tool_choice = "auto";
    } else if (claudeRequest.tool_choice.type === "tool") {
      openaiRequest.tool_choice = { type: "function", function: { name: claudeRequest.tool_choice.name } };
    }
  }
  return openaiRequest;
}
__name(convertClaudeToOpenAIRequest, "convertClaudeToOpenAIRequest");
function convertOpenAIToClaudeResponse(openaiResponse, model) {
  const choice = openaiResponse.choices[0];
  const contentBlocks = [];
  if (choice.message.content) {
    contentBlocks.push({ type: "text", text: choice.message.content });
  }
  if (choice.message.tool_calls) {
    choice.message.tool_calls.forEach((call) => {
      contentBlocks.push({
        type: "tool_use",
        id: call.id,
        name: call.function.name,
        input: JSON.parse(call.function.arguments)
      });
    });
  }
  const stopReasonMap = { stop: "end_turn", length: "max_tokens", tool_calls: "tool_use" };
  return {
    id: openaiResponse.id,
    type: "message",
    role: "assistant",
    model,
    content: contentBlocks,
    stop_reason: stopReasonMap[choice.finish_reason] || "end_turn",
    usage: {
      input_tokens: openaiResponse.usage.prompt_tokens,
      output_tokens: openaiResponse.usage.completion_tokens
    }
  };
}
__name(convertOpenAIToClaudeResponse, "convertOpenAIToClaudeResponse");
function streamTransformer(model) {
  let initialized = false;
  let buffer = "";
  const messageId = `msg_${Math.random().toString(36).substr(2, 9)}`;
  const toolCalls = {};
  let contentBlockIndex = 0;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const sendEvent = /* @__PURE__ */ __name((controller, event, data) => {
    controller.enqueue(encoder.encode(`event: ${event}
data: ${JSON.stringify(data)}

`));
  }, "sendEvent");
  return (chunk, controller) => {
    if (!initialized) {
      sendEvent(controller, "message_start", { type: "message_start", message: { id: messageId, type: "message", role: "assistant", model, content: [], stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } });
      sendEvent(controller, "content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
      initialized = true;
    }
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.substring(6);
      if (data.trim() === "[DONE]") {
        sendEvent(controller, "content_block_stop", { type: "content_block_stop", index: 0 });
        Object.values(toolCalls).forEach((tc) => {
          if (tc.started) sendEvent(controller, "content_block_stop", { type: "content_block_stop", index: tc.claudeIndex });
        });
        let finalStopReason = "end_turn";
        try {
          const lastChunk = JSON.parse(lines[lines.length - 2].substring(6));
          const finishReason = lastChunk.choices[0].finish_reason;
          if (finishReason === "tool_calls") finalStopReason = "tool_use";
          if (finishReason === "length") finalStopReason = "max_tokens";
        } catch {
        }
        sendEvent(controller, "message_delta", { type: "message_delta", delta: { stop_reason: finalStopReason, stop_sequence: null }, usage: { output_tokens: 0 } });
        sendEvent(controller, "message_stop", { type: "message_stop" });
        controller.terminate();
        return;
      }
      try {
        const openaiChunk = JSON.parse(data);
        const delta = openaiChunk.choices[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          sendEvent(controller, "content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: delta.content } });
        }
        if (delta.tool_calls) {
          for (const tc_delta of delta.tool_calls) {
            const index = tc_delta.index;
            if (!toolCalls[index]) {
              toolCalls[index] = { id: "", name: "", args: "", claudeIndex: 0, started: false };
            }
            if (tc_delta.id) toolCalls[index].id = tc_delta.id;
            if (tc_delta.function?.name) toolCalls[index].name = tc_delta.function.name;
            if (tc_delta.function?.arguments) toolCalls[index].args += tc_delta.function.arguments;
            if (toolCalls[index].id && toolCalls[index].name && !toolCalls[index].started) {
              contentBlockIndex++;
              toolCalls[index].claudeIndex = contentBlockIndex;
              toolCalls[index].started = true;
              sendEvent(controller, "content_block_start", { type: "content_block_start", index: contentBlockIndex, content_block: { type: "tool_use", id: toolCalls[index].id, name: toolCalls[index].name, input: {} } });
            }
            if (toolCalls[index].started && tc_delta.function?.arguments) {
              sendEvent(controller, "content_block_delta", { type: "content_block_delta", index: toolCalls[index].claudeIndex, delta: { type: "input_json_delta", partial_json: tc_delta.function.arguments } });
            }
          }
        }
      } catch (e) {
      }
    }
  };
}
__name(streamTransformer, "streamTransformer");
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, Anthropic-Version"
  };
}
__name(corsHeaders, "corsHeaders");
function handleOptions() {
  return new Response(null, { headers: corsHeaders() });
}
__name(handleOptions, "handleOptions");

// ../../../../../node-v24.7.0-win-x64/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../../node-v24.7.0-win-x64/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-hk9ROd/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../../../../node-v24.7.0-win-x64/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-hk9ROd/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
