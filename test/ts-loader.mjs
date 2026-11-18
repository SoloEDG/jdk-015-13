/**
 * 仅用于 node --test：让 extensionless 的相对导入解析到 .ts 文件，
 * 使应用源码（vite/tsc 的 bundler 风格）无需为测试改写成带扩展名。
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[cm]?[tj]s$|\/$/.test(specifier)) {
    const base = new URL(specifier, context.parentURL);
    for (const candidate of [base.href + ".ts", base.href + "/index.ts"]) {
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(pathToFileURL(fileURLToPath(candidate)).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
