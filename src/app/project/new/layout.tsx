/**
 * 禁用项目创建页面的 SSG 预渲染
 * 因为这是一个纯客户端表单页面，构建时不需要 prerender
 */

export const dynamic = 'force-dynamic';
export const dynamicParams = true;

export default function ProjectNewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
