import { assert, describe, it } from "@effect/vitest";

import { buildRemoteNodeEnvScript } from "./remoteNodeEnvScript.ts";

const TEST_NODE_ENGINE_RANGE = "^22.16 || ^23.11 || >=24.10";

describe("buildRemoteNodeEnvScript", () => {
  it("resolves node via supported version managers", () => {
    const script = buildRemoteNodeEnvScript({ nodeEngineRange: TEST_NODE_ENGINE_RANGE });

    assert.include(script, "ensure_remote_node_path()");
    assert.include(script, "remote_node_satisfies_engine()");
    assert.include(script, 'prepend_path_if_dir "$HOME/.local/bin"');
    assert.include(script, 'prepend_path_if_dir "$VOLTA_HOME/bin"');
    assert.include(script, 'prepend_path_if_dir "$HOME/.asdf/shims"');
    assert.include(script, 'prepend_path_if_dir "$HOME/.local/share/mise/shims"');
    assert.include(script, 'eval "$(fnm env --shell bash)"');
    assert.include(script, "fnm use --silent-if-unchanged");
    assert.include(script, "fnm use default");
    assert.include(script, 'prepend_path_if_dir "$HOME/.nodenv/shims"');
    assert.include(script, 'NVM_DIR="$HOME/.nvm"');
    assert.include(script, "nvm use --silent default");
    assert.include(script, 'for T3_NODE_BIN in "$NVM_DIR"/versions/node/*/bin');
  });

  it("embeds the node engine range and its semver check", () => {
    const script = buildRemoteNodeEnvScript({ nodeEngineRange: TEST_NODE_ENGINE_RANGE });

    assert.include(script, `T3_NODE_ENGINE_RANGE='${TEST_NODE_ENGINE_RANGE}'`);
    assert.include(script, "function satisfiesSemverRange");
    assert.include(script, "satisfiesSemverRange(rawVersion, range)");
    assert.include(script, "does not satisfy required range ");
  });

  it("does not hard-code a remote node engine range", () => {
    const script = buildRemoteNodeEnvScript();

    assert.include(script, "T3_NODE_ENGINE_RANGE=''");
    assert.notInclude(script, TEST_NODE_ENGINE_RANGE);
  });
});
