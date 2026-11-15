import { EcommerceCarrierError } from '../../../errors';
import { timedFetch } from '../../http';
import type { CarrierCallOptions } from '../types';
import { normalizePudoItems, type PickupPoint } from './payload';

/**
 * DPD pickup points (spec 2.2): SOAP 1.1 `GetPudoList` posted by hand (Ruling 12, no SOAP library).
 * Namespace and SOAPAction as published in the service WSDL
 * (`http://mypudo.pickup-services.com/mypudo/mypudo.asmx?wsdl`, read 2026-11-14): note the
 * capitals in `MyPudo`, which differ from the plan's default.
 */
export const PUDO_NAMESPACE = 'http://MyPudo.pickup-services.com/';
export const PUDO_SOAP_ACTION = `${PUDO_NAMESPACE}GetPudoList`;

const searchFailed = (message: string) => new EcommerceCarrierError('PICKUP_SEARCH_FAILED', message);

const escapeXml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const decodeXml = (v: string) =>
  v
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** The endpoint without its `?wsdl` query. */
export const pudoServiceUrl = (endpoint: string) => endpoint.trim().replace(/\?wsdl$/i, '');

/** Arguments in the WSDL's sequence order. */
function envelope(key: string, postalCode: string): string {
  const args: [string, string][] = [
    ['carrier', 'CHR'],
    ['key', key],
    ['zipCode', postalCode],
    ['city', '?'],
    ['countrycode', 'PRT'],
    ['requestID', 'DPD-PT'],
  ];
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    `<soap:Body><GetPudoList xmlns="${PUDO_NAMESPACE}">` +
    args.map(([name, value]) => `<${name}>${escapeXml(value)}</${name}>`).join('') +
    '</GetPudoList></soap:Body></soap:Envelope>'
  );
}

// ---------------------------------------------------------------------------
// A small tag reader: elements by local name, text decoded, attributes ignored.
// ---------------------------------------------------------------------------

type XmlNode = { name: string; children: XmlNode[]; text: string };

const TOKEN = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<[?!][\s\S]*?>|<(\/?)([^\s>/]+)[^>]*?(\/?)>|([^<]+)/g;

function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: '#root', children: [], text: '' };
  const stack: XmlNode[] = [root];
  for (const m of xml.matchAll(TOKEN)) {
    const top = stack[stack.length - 1];
    const [, cdata, closing, rawName, selfClosing, chars] = m;
    if (cdata !== undefined) top.text += cdata;
    else if (chars !== undefined) top.text += decodeXml(chars);
    else if (rawName !== undefined) {
      const name = rawName.includes(':') ? rawName.slice(rawName.indexOf(':') + 1) : rawName;
      if (closing) {
        if (stack.length > 1 && top.name === name) stack.pop();
      } else {
        const node: XmlNode = { name, children: [], text: '' };
        top.children.push(node);
        if (!selfClosing) stack.push(node);
      }
    }
  }
  return root;
}

function find(node: XmlNode, name: string): XmlNode | null {
  for (const child of node.children) {
    if (child.name === name) return child;
    const deep = find(child, name);
    if (deep) return deep;
  }
  return null;
}

/** Leaf → trimmed text; otherwise `{ name: value | value[] }` (repeated names become lists). */
function toValue(node: XmlNode): unknown {
  if (node.children.length === 0) return node.text.trim();
  const out: Record<string, unknown> = {};
  for (const child of node.children) {
    const value = toValue(child);
    const prev = out[child.name];
    if (prev === undefined) out[child.name] = value;
    else if (Array.isArray(prev)) prev.push(value);
    else out[child.name] = [prev, value];
  }
  return out;
}

/** The `RESPONSE` node, whether the result holds it as XML or as escaped XML text. */
function responseOf(xml: string): XmlNode | null {
  const result = find(parseXml(xml), 'GetPudoListResult');
  if (!result) return null;
  const direct = find(result, 'RESPONSE');
  if (direct) return direct;
  return result.text.includes('<') ? find(parseXml(result.text), 'RESPONSE') : null;
}

/**
 * Pickup points near `postalCode`. Any transport problem, an unreadable answer or a
 * `RESPONSE.ERROR` throws `PICKUP_SEARCH_FAILED` (never with the key or the answer).
 */
export async function searchPudo(
  endpoint: string,
  key: string,
  postalCode: string,
  opts: Partial<CarrierCallOptions> = {}
): Promise<PickupPoint[]> {
  const res = await timedFetch<{ status: number; text: string }>(
    pudoServiceUrl(endpoint),
    {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${PUDO_SOAP_ACTION}"` },
      body: envelope(key, postalCode),
    },
    async (r) => ({ status: r.status, text: await r.text() }),
    opts.timeoutMs
  );
  if (!res) throw searchFailed('Could not reach the DPD pickup point service.');
  if (res.status !== 200) throw searchFailed(`The DPD pickup point service failed (HTTP ${res.status}).`);
  const response = responseOf(res.text);
  if (!response) throw searchFailed('The DPD pickup point service sent an unreadable answer.');
  const error = find(response, 'ERROR');
  if (error && (error.text.trim() || error.children.length)) {
    throw searchFailed('The DPD pickup point service returned an error.');
  }
  const items = find(response, 'PUDO_ITEMS');
  return items ? normalizePudoItems(toValue(items)) : [];
}
