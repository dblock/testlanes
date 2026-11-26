import { Recorder } from "./record.js";

/**
 * Vitest reporter that records each test module's preparation, environment,
 * collection, setup, and execution time when `TESTLANES_TIMINGS` is set.
 */
export default class TestlanesVitestReporter {
  constructor() {
    this.recorder = new Recorder();
  }

  /**
   * @param {{ moduleId: string, diagnostic(): Record<string, unknown> }} testModule
   */
  onTestModuleEnd(testModule) {
    const diagnostic = testModule.diagnostic();
    let milliseconds = 0;
    for (const key of ["environmentSetupDuration", "prepareDuration", "collectDuration", "setupDuration", "duration"]) {
      const value = diagnostic[key];
      if (typeof value === "number") milliseconds += value;
    }
    this.recorder.add(testModule.moduleId, milliseconds);
  }

  onTestRunEnd() {
    this.recorder.write();
  }
}
