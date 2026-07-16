import { describe, expect, it, jest } from "@jest/globals";
import { EPX_BANNER, printBanner } from "../src/banner.js";

describe("CLI banner", () => {
  it("renders the ExplainX ASCII art to stderr", () => {
    const write = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    printBanner();
    expect(EPX_BANNER).toContain("_____  ___ __");
    expect(write).toHaveBeenCalledWith(expect.stringContaining("|_|"));
    write.mockRestore();
  });
});
