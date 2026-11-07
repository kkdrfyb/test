// 浏览器端不使用 chmlib-ts 的文件路径读取器；此桩模块仅用于让打包器解析其动态 import。
export async function open() {
  throw new Error('浏览器环境不支持按路径读取 CHM，请使用内存读取器');
}
