import { describe, expect, it } from "vitest";
import {
  basename,
  basenameOf,
  byteLength,
  compareKeyLike,
  displayPathLike,
  isExcluded,
  isInsideWorkspaceLike,
  isPathInside,
  isTrackableSchemeLike,
  normalizePath,
  relativePath,
  untitledLabel,
} from "../../src/core/pathUtils";
import type { FolderLike, UriLike } from "../../src/core/pathUtils";

interface FakeUriInit {
  scheme?: string;
  authority?: string;
  path: string;
  fsPath?: string;
}

function fakeUri(init: FakeUriInit): UriLike {
  const scheme = init.scheme ?? "file";
  const authority = init.authority ?? "";
  const path = init.path.replace(/\\/g, "/");
  const fsPath = init.fsPath ?? (process.platform === "win32" ? `C:\\${path.replace(/\//g, "\\")}` : `/${path}`);
  return {
    scheme,
    authority,
    path,
    fsPath,
    toString: () => `${scheme}://${authority}${path}`,
  };
}

function folder(path: string): FolderLike {
  return { uri: fakeUri({ path }) };
}

describe("isExcluded", () => {
  it("returns false for an empty glob list", () => {
    expect(isExcluded("node_modules/react/index.js", [])).toBe(false);
  });

  it("excludes node_modules by default pattern", () => {
    expect(isExcluded("node_modules/react/index.js", ["**/node_modules/**"])).toBe(true);
    expect(isExcluded("packages/app/node_modules/x/y.js", ["**/node_modules/**"])).toBe(true);
  });

  it("matches nested files with directory globs", () => {
    const globs = ["**/dist/**", "**/.git/**"];
    expect(isExcluded("a/b/c/dist/bundle.js", globs)).toBe(true);
    expect(isExcluded(".git/HEAD", globs)).toBe(true);
    expect(isExcluded("src/district/file.ts", globs)).toBe(false);
  });

  it("does not use basename matching when the pattern has a directory", () => {
    expect(isExcluded("src/index.ts", ["dist/index.ts"])).toBe(false);
    expect(isExcluded("dist/index.ts", ["dist/index.ts"])).toBe(true);
  });

  it("matches dotfiles with dot:true (deep globstar reaches dot segments)", () => {
    expect(isExcluded("config/.env", ["**/*.env"])).toBe(true);
    expect(isExcluded("src/.hidden/file.ts", ["**/.hidden/**"])).toBe(true);
  });

  it("normalizes backslashes in paths and patterns", () => {
    expect(isExcluded("src\\dist\\bundle.js", ["**/dist/**"])).toBe(true);
    expect(isExcluded("src/dist/bundle.js", ["**\\dist\\**"])).toBe(true);
    expect(isExcluded("./src/out/app.js", ["**/out/**"])).toBe(true);
  });

  it("treats malformed or empty patterns as non-matching", () => {
    expect(isExcluded("src/app.ts", ["", "   "])).toBe(false);
    expect(isExcluded("src/app.ts", ["["])).toBe(false);
  });

  it("never excludes an empty relative path", () => {
    expect(isExcluded("", ["**/*"])).toBe(false);
  });

  it("does not treat plain globs as regex-like negations", () => {
    expect(isExcluded("src/app.ts", ["!**/*.ts"])).toBe(false);
    expect(isExcluded("src/app.js", ["!**/*.ts"])).toBe(false);
  });
});

describe("byteLength", () => {
  it("counts ASCII bytes", () => {
    expect(byteLength("hello")).toBe(5);
    expect(byteLength("")).toBe(0);
    expect(byteLength("a\r\nb")).toBe(4);
  });

  it("counts Persian text as 2 bytes per character", () => {
    expect(byteLength("فارسی")).toBe(10);
  });

  it("counts emoji as 4-byte surrogate pairs", () => {
    expect(byteLength("🚀")).toBe(4);
    expect(byteLength("a🚀b")).toBe(6);
  });

  it("counts combining sequences by encoded bytes", () => {
    expect(byteLength("é")).toBe(2);
    expect(byteLength("e\u0301")).toBe(3);
  });
});

describe("basename", () => {
  it("handles POSIX and Windows separators", () => {
    expect(basenameOf("src/core/config.ts")).toBe("config.ts");
    expect(basenameOf("src\\core\\config.ts")).toBe("config.ts");
    expect(basenameOf("/")).toBe("");
    expect(basenameOf("file.ts")).toBe("file.ts");
  });

  it("works with URI-like objects", () => {
    expect(basename(fakeUri({ path: "/home/user/app/main.py" }) as never)).toBe("main.py");
    expect(basename(fakeUri({ path: "/Untitled-3" }) as never)).toBe("Untitled-3");
  });
});

describe("path helpers", () => {
  it("normalizes separators and trailing slashes", () => {
    expect(normalizePath("a\\b\\c\\")).toBe("a/b/c");
    expect(normalizePath("a//b///c")).toBe("a/b/c");
  });

  it("detects separator-bounded containment", () => {
    expect(isPathInside("/work/app/src/a.ts", "/work/app")).toBe(true);
    expect(isPathInside("/work/app", "/work/app")).toBe(true);
    expect(isPathInside("/work/app2/a.ts", "/work/app")).toBe(false);
    expect(isPathInside("/other/a.ts", "/work/app")).toBe(false);
  });

  it("computes relative paths with forward slashes", () => {
    expect(relativePath("/work/app/src/a.ts", "/work/app")).toBe("src/a.ts");
    expect(relativePath("/work/app", "/work/app")).toBe("");
    expect(relativePath("/work/other/a.ts", "/work/app")).toBe("");
  });
});

describe("isInsideWorkspaceLike", () => {
  it("requires matching scheme and authority", () => {
    const folders = [folder("/work/app")];
    expect(isInsideWorkspaceLike(fakeUri({ path: "/work/app/src/a.ts" }), folders)).toBe(true);
    expect(
      isInsideWorkspaceLike(fakeUri({ scheme: "untitled", path: "/Untitled-1" }), folders),
    ).toBe(false);
    expect(
      isInsideWorkspaceLike(fakeUri({ path: "/work/app/a.ts", scheme: "vscode-remote" }), [
        folder("/work/app"),
      ]),
    ).toBe(false);
  });

  it("rejects siblings with a shared prefix", () => {
    const folders = [folder("/work/app")];
    expect(isInsideWorkspaceLike(fakeUri({ path: "/work/app-other/a.ts" }), folders)).toBe(false);
  });

  it("returns false without folders", () => {
    expect(isInsideWorkspaceLike(fakeUri({ path: "/work/app/a.ts" }), [])).toBe(false);
  });
});

describe("displayPathLike", () => {
  const single = [folder("/work/app")];
  const multi = [folder("/work/app"), folder("/work/lib")];

  it("returns the folder-relative path for single-root workspaces", () => {
    expect(displayPathLike(fakeUri({ path: "/work/app/src/a.ts" }), single, false)).toBe("src/a.ts");
  });

  it("prefixes the folder name for multi-root workspaces", () => {
    expect(displayPathLike(fakeUri({ path: "/work/lib/x/y.ts" }), multi, true)).toBe("lib/x/y.ts");
  });

  it("falls back to the basename outside the workspace, never absolute", () => {
    const label = displayPathLike(fakeUri({ path: "/elsewhere/deep/secret.ts" }), single, false);
    expect(label).toBe("secret.ts");
    expect(label.startsWith("/")).toBe(false);
    expect(label).not.toContain("elsewhere");
  });

  it("labels untitled documents readably", () => {
    expect(displayPathLike(fakeUri({ scheme: "untitled", path: "/Untitled-1" }), single, false)).toBe(
      "Untitled-1",
    );
    expect(untitledLabel(fakeUri({ scheme: "untitled", path: "/note" }))).toBe("Untitled-note");
    expect(untitledLabel(fakeUri({ scheme: "untitled", path: "/" }))).toBe("Untitled");
  });
});

describe("scheme and compare keys", () => {
  it("accepts only file and untitled schemes", () => {
    expect(isTrackableSchemeLike(fakeUri({ path: "/a" }))).toBe(true);
    expect(isTrackableSchemeLike(fakeUri({ scheme: "untitled", path: "/Untitled-1" }))).toBe(true);
    expect(isTrackableSchemeLike(fakeUri({ scheme: "git", path: "/a" }))).toBe(false);
    expect(isTrackableSchemeLike(fakeUri({ scheme: "output", path: "/a" }))).toBe(false);
  });

  it("folds only the fsPath casing on win32", () => {
    const uri = fakeUri({ path: "/Work/App/File.TS" });
    const key = compareKeyLike(uri);
    if (process.platform === "win32") {
      expect(key.toLowerCase()).toBe(uri.toString().toLowerCase());
      expect(key.startsWith("file://")).toBe(true);
    } else {
      expect(key).toBe(uri.toString());
    }
  });
});
