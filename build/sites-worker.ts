import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

export default {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const origin = (env as unknown as {LUMEN_PUBLIC_ORIGIN?:string}).LUMEN_PUBLIC_ORIGIN;
    if (origin) {
      const incoming = new URL(request.url);
      const headers = new Headers(request.headers);
      for (const name of [...headers.keys()]) if (/^(oai-|x-sites-|x-forwarded-)/i.test(name)) headers.delete(name);
      request = new Request(origin + incoming.pathname + incoming.search, {method:request.method,headers,signal:request.signal,redirect:'manual',...(!['GET','HEAD'].includes(request.method)?{body:request.body}:{})});
    }
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
  },
};
