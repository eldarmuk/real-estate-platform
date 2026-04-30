import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const basePath = '/real-estate-platform/';
const sourceDir = path.resolve('dist', 'frontend', 'browser');
const publishRoot = path.resolve('dist', 'netlify');
const targetDir = path.join(publishRoot, 'real-estate-platform');
const targetIndex = path.join(targetDir, 'index.html');

await rm(publishRoot, { recursive: true, force: true });
await mkdir(targetDir, { recursive: true });
await cp(sourceDir, targetDir, { recursive: true });

const indexHtml = await readFile(targetIndex, 'utf8');
await writeFile(targetIndex, indexHtml.replace(/<base href="[^"]*">/, `<base href="${basePath}">`));

console.log(`Prepared Netlify build at ${targetDir}`);
