import assert from "node:assert/strict";
import test from "node:test";

import {
  BROWSER_DYNAMIC_TOOLS,
  isConsequentialBrowserElement,
  isPrivateAddress,
  matchesDomain
} from "../src/browser/controller.js";

test("blocks private and loopback network addresses", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.1.1", "::1", "fd00::1", "fe80::1"]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});

test("requires confirmation for submit-like browser elements", () => {
  assert.equal(isConsequentialBrowserElement({ tag: "input", type: "submit", label: "", href: "" }), true);
  assert.equal(isConsequentialBrowserElement({ tag: "button", type: "button", label: "确认支付", href: "" }), true);
  assert.equal(isConsequentialBrowserElement({ tag: "a", type: "", label: "Delete account", href: "https://example.com/delete" }), true);
  assert.equal(isConsequentialBrowserElement({ tag: "a", type: "", label: "Read documentation", href: "https://example.com/docs" }), false);
});

test("allows every public hostname when the explicit wildcard is configured", () => {
  assert.equal(matchesDomain("v.douyin.com", ["*"]), true);
  assert.equal(matchesDomain("example.com", ["*"]), true);
  assert.equal(matchesDomain("sub.example.com", ["example.com"]), true);
});

test("exposes only the bounded browser tool set", () => {
  const namespace = BROWSER_DYNAMIC_TOOLS[0];
  assert.equal(namespace.type, "namespace");
  assert.deepEqual(namespace.type === "namespace" ? namespace.tools.map((tool) => tool.name) : [], [
    "navigate",
    "snapshot",
    "click",
    "fill",
    "screenshot",
    "upload"
  ]);
});
