import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const basePath = '/real-estate-platform/';
const railwayOrigin = 'https://real-estate-platform-production-17ac.up.railway.app';
const sourceDir = path.resolve('dist', 'frontend', 'browser');
const publishRoot = path.resolve('dist', 'netlify');
const targetDir = path.join(publishRoot, 'real-estate-platform');
const targetIndex = path.join(targetDir, 'index.html');
const redirectsPath = path.join(publishRoot, '_redirects');
const uiPublishRoot = path.resolve('frontend', 'dist', 'netlify');

await rm(publishRoot, { recursive: true, force: true });
await mkdir(targetDir, { recursive: true });
await cp(sourceDir, targetDir, { recursive: true });

const indexHtml = await readFile(targetIndex, 'utf8');
await writeFile(targetIndex, indexHtml.replace(/<base href="[^"]*">/, `<base href="${basePath}">`));
await writeFile(
  redirectsPath,
  [
    '/real-estate-platform /real-estate-platform/ 301',
    `/real-estate-platform/api/* ${railwayOrigin}/api/:splat 200!`,
    '/real-estate-platform/* /real-estate-platform/index.html 200',
    '',
  ].join('\n'),
);

if (path.basename(process.cwd()).toLowerCase() === 'frontend') {
  await rm(uiPublishRoot, { recursive: true, force: true });
  await mkdir(path.dirname(uiPublishRoot), { recursive: true });
  await cp(publishRoot, uiPublishRoot, { recursive: true });
}

console.log(`Prepared Netlify build at ${targetDir}`);
