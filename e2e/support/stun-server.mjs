// Minimal RFC 5389 STUN Binding server for the WebRTC E2E test.
//
// Answers every Binding Request with a Binding Success Response whose
// XOR-MAPPED-ADDRESS (and MAPPED-ADDRESS, for old clients) is the UDP source
// address the request actually arrived from — nothing is invented. The frontend
// is built with VITE_TEST_EXTRA_STUN=127.0.0.1:<port> (frontend/utils/webrtc-ice.js),
// so the WebRTC page asks this server alongside the public list and the test log
// can reach a verdict on a runner without outbound UDP.
//
// Usage as a module: `const stun = await startStunServer({ port }); … stun.close()`.
// Usage standalone:   node e2e/support/stun-server.mjs [port] [host]

import dgram from 'node:dgram';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const MAGIC = 0x2112a442;

const attr = (type, value) => {
    const pad = (4 - (value.length % 4)) % 4;
    const head = Buffer.alloc(4);
    head.writeUInt16BE(type, 0);
    head.writeUInt16BE(value.length, 2);
    return Buffer.concat([head, value, Buffer.alloc(pad)]);
};

const addressValue = (address, port, xor, tid) => {
    const v6 = net.isIPv6(address);
    const raw = v6
        ? Buffer.from(address.includes('.') ? [] : expandV6(address))
        : Buffer.from(address.split('.').map(Number));
    const out = Buffer.alloc(4 + raw.length);
    out.writeUInt8(0, 0);
    out.writeUInt8(v6 ? 2 : 1, 1);
    out.writeUInt16BE(xor ? port ^ (MAGIC >>> 16) : port, 2);
    if (xor) {
        const key = Buffer.concat([Buffer.from([0x21, 0x12, 0xa4, 0x42]), tid]);
        for (let i = 0; i < raw.length; i += 1) out[4 + i] = raw[i] ^ key[i];
    } else {
        raw.copy(out, 4);
    }
    return out;
};

const expandV6 = (address) => {
    const [head, tail = ''] = address.split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    const groups = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
    return groups.flatMap((g) => {
        const n = parseInt(g || '0', 16);
        return [n >> 8, n & 0xff];
    });
};

export const bindingResponse = (packet, rinfo) => {
    if (packet.length < 20) return null;
    const type = packet.readUInt16BE(0);
    const magic = packet.readUInt32BE(4);
    if (magic !== MAGIC || type !== 0x0001) return null;
    const tid = packet.subarray(8, 20);
    const body = Buffer.concat([
        attr(0x0020, addressValue(rinfo.address, rinfo.port, true, tid)),
        attr(0x0001, addressValue(rinfo.address, rinfo.port, false, tid)),
        attr(0x8022, Buffer.from('trustip-e2e-stun')),
    ]);
    const head = Buffer.alloc(8);
    head.writeUInt16BE(0x0101, 0);
    head.writeUInt16BE(body.length, 2);
    head.writeUInt32BE(MAGIC, 4);
    return Buffer.concat([head, tid, body]);
};

export const startStunServer = ({ port = 43478, host = '127.0.0.1', onRequest } = {}) => new Promise((resolve, reject) => {
    const socket = dgram.createSocket(net.isIPv6(host) ? 'udp6' : 'udp4');
    const requests = [];
    socket.on('message', (packet, rinfo) => {
        const response = bindingResponse(packet, rinfo);
        const entry = { t: Date.now(), from: `${rinfo.address}:${rinfo.port}`, result: response ? 'binding-success' : 'ignored' };
        requests.push(entry);
        onRequest?.(entry);
        if (response) socket.send(response, rinfo.port, rinfo.address);
    });
    socket.once('error', reject);
    socket.bind(port, host, () => {
        socket.off('error', reject);
        resolve({ port: socket.address().port, requests, close: () => new Promise((r) => socket.close(r)) });
    });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const port = Number(process.argv[2] || 43478);
    const host = process.argv[3] || '127.0.0.1';
    const stun = await startStunServer({ port, host, onRequest: (e) => console.log(JSON.stringify(e)) });
    console.log(`stun listening on ${host}:${stun.port}`);
}
