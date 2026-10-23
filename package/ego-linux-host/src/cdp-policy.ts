import { egoError } from "./errors.js";
// Explicit audited SDK inventory. Host handles browser/Target methods separately.
export const sessionMethods = new Set(
  `Accessibility.enable Accessibility.getFullAXTree Accessibility.getPartialAXTree DOM.getDocument DOM.describeNode DOM.getBoxModel DOM.getFrameOwner DOM.resolveNode DOM.scrollIntoViewIfNeeded DOM.setFileInputFiles DOM.querySelector DOM.querySelectorAll DOM.getNodeForLocation DOM.focus Emulation.setDeviceMetricsOverride Emulation.clearDeviceMetricsOverride Input.dispatchKeyEvent Input.dispatchMouseEvent Input.dispatchTouchEvent Input.insertText Input.synthesizeScrollGesture Network.enable Network.disable Page.enable Page.getFrameTree Page.createIsolatedWorld Page.navigate Page.reload Page.stopLoading Page.captureScreenshot Page.handleJavaScriptDialog Page.setInterceptFileChooserDialog Page.getLayoutMetrics Runtime.enable Runtime.evaluate Runtime.callFunctionOn Runtime.getProperties Runtime.releaseObject Runtime.releaseObjectGroup Runtime.runIfWaitingForDebugger Runtime.terminateExecution Fetch.enable Fetch.disable Fetch.continueRequest Fetch.failRequest Fetch.fulfillRequest Debugger.enable Debugger.disable Debugger.resume`.split(
    " ",
  ),
);
export function assertMethod(method: string) {
  if (!sessionMethods.has(method))
    throw egoError(
      "EGO_CDP_SEND_FAILED",
      `Unsupported task-scoped CDP method: ${method}`,
    );
}
export function validateEmbedded(
  params: any,
  validateTarget: (id: string) => void,
  validateSession: (id: string) => void,
) {
  const visit = (v: any, key = "") => {
    if (!v || typeof v !== "object") return;
    for (const [k, value] of Object.entries(v)) {
      if (k === "browserContextId")
        throw egoError(
          "EGO_CDP_SEND_FAILED",
          "Browser context operations are not permitted",
        );
      if (k === "targetId") {
        if (typeof value !== "string") throw new Error("Invalid targetId");
        validateTarget(value);
      }
      if (k === "sessionId") {
        if (typeof value !== "string") throw new Error("Invalid sessionId");
        validateSession(value);
      }
      if (k === "message")
        throw egoError(
          "EGO_CDP_SEND_FAILED",
          "Nested CDP transport is not permitted",
        );
      visit(value, k);
    }
  };
  visit(params);
}
