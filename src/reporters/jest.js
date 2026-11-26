import { Recorder } from "./record.js";

/**
 * Jest reporter that records each test file's runtime when `TESTLANES_TIMINGS` is set.
 */
export default class TestlanesJestReporter {
  constructor() {
    this.recorder = new Recorder();
  }

  /**
   * @param {unknown} _test
   * @param {{ testFilePath: string, perfStats?: { runtime?: number } }} result
   */
  onTestResult(_test, result) {
    this.recorder.add(result.testFilePath, result.perfStats?.runtime ?? 0);
  }

  onRunComplete() {
    this.recorder.write();
  }

  getLastError() {
    return undefined;
  }
}
