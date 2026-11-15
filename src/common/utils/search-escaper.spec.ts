import { escapeLikeString } from "./search-escaper";

describe("search-escaper Unit Tests", () => {
  it("escapes percent signs", () => {
    expect(escapeLikeString("100% discount")).toBe("100\\% discount");
  });

  it("escapes underscores", () => {
    expect(escapeLikeString("task_1")).toBe("task\\_1");
  });

  it("escapes backslashes", () => {
    expect(escapeLikeString("path\\file")).toBe("path\\\\file");
  });

  it("handles mixed special characters", () => {
    expect(escapeLikeString("100%_complete\\tested")).toBe("100\\%\\_complete\\\\tested");
  });

  it("leaves standard characters untouched", () => {
    expect(escapeLikeString("Normal search string 123-abc")).toBe("Normal search string 123-abc");
  });
});
