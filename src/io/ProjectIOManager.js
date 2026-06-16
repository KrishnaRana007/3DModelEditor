/**
 * ProjectIOManager
 *
 * Keeps file download/upload helpers and custom XML wrapping outside the main
 * editor runtime. The editor still owns scene serialization because it already
 * has access to live Three.js objects, selection state, timeline state, and UI.
 */
export function downloadTextFile(filename, content, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Unable to read file.'));
    reader.readAsText(file);
  });
}

function encodeBase64Unicode(text) {
  return btoa(unescape(encodeURIComponent(text)));
}

function decodeBase64Unicode(text) {
  return decodeURIComponent(escape(atob(text)));
}

export function projectJsonToXml(project) {
  const json = JSON.stringify(project, null, 2);
  const encoded = encodeBase64Unicode(json);
  const created = project?.meta?.savedAt || new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<ThreeDModelEditorProject version="${project?.version || 1}" created="${created}">\n` +
    `  <ProjectData encoding="base64-json">${encoded}</ProjectData>\n` +
    `</ThreeDModelEditorProject>\n`;
}

export function projectXmlToJson(xmlText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, 'application/xml');
  const error = xml.querySelector('parsererror');
  if (error) throw new Error('Invalid XML project file.');
  const data = xml.querySelector('ProjectData');
  if (!data) throw new Error('XML project file does not contain ProjectData.');
  const encoding = data.getAttribute('encoding') || '';
  if (encoding !== 'base64-json') throw new Error('Unsupported XML project encoding.');
  return JSON.parse(decodeBase64Unicode((data.textContent || '').trim()));
}
