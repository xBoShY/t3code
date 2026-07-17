import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

// The desktop backend is always bound to loopback: the fork ships without the
// LAN/Tailscale exposure feature, so there is no LAN bind host or advertised
// endpoint to resolve. This service just carries the resolved backend port
// (chosen once during bootstrap) to the config resolvers and the WSL backend,
// which read it back lazily when the pool (re)starts an instance.
export const DESKTOP_LOOPBACK_HOST = "127.0.0.1";

export interface DesktopBackendEndpointConfig {
  readonly port: number;
  readonly bindHost: string;
  readonly httpBaseUrl: URL;
}

const resolveConfig = (port: number): DesktopBackendEndpointConfig => ({
  port,
  bindHost: DESKTOP_LOOPBACK_HOST,
  httpBaseUrl: new URL(`http://${DESKTOP_LOOPBACK_HOST}:${port}`),
});

export class DesktopBackendEndpoint extends Context.Service<
  DesktopBackendEndpoint,
  {
    readonly configure: (input: {
      readonly port: number;
    }) => Effect.Effect<DesktopBackendEndpointConfig>;
    readonly backendConfig: Effect.Effect<DesktopBackendEndpointConfig>;
  }
>()("@t3tools/desktop/backend/DesktopBackendEndpoint") {}

export const make = Effect.gen(function* () {
  const stateRef = yield* Ref.make(resolveConfig(0));

  return DesktopBackendEndpoint.of({
    configure: ({ port }) =>
      Ref.updateAndGet(stateRef, () => resolveConfig(port)).pipe(
        Effect.withSpan("desktop.backendEndpoint.configure", { attributes: { port } }),
      ),
    backendConfig: Ref.get(stateRef),
  });
});

export const layer = Layer.effect(DesktopBackendEndpoint, make);

export const layerTest = (port = 0) =>
  Layer.effect(
    DesktopBackendEndpoint,
    Effect.gen(function* () {
      const stateRef = yield* Ref.make(resolveConfig(port));
      return DesktopBackendEndpoint.of({
        configure: ({ port: nextPort }) =>
          Ref.updateAndGet(stateRef, () => resolveConfig(nextPort)),
        backendConfig: Ref.get(stateRef),
      });
    }),
  );
