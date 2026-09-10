// netdisk-check 私有 API 探测的确定性测试 —— mock fetch，不发真实网络请求
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  checkNetdiskApi,
  checkQuarkApi,
  checkUcApi,
  checkBaiduApi,
  checkAliyunApi,
  check115Api,
  check123Api,
  checkTianyiApi,
  checkXunleiApi,
  checkMobileApi,
} from '../src/service/netdisk-check.ts';
import { checkLinks } from '../src/service/check.ts';

type MockHandler = (url: string, opts: { method?: string; body?: string }) => Response;

/** 临时替换全局 fetch（测试后恢复），handler 抛错 = 网络错误 */
function withMockFetch(handler: MockHandler, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, opts?: RequestInit) =>
    handler(String(url), { method: opts?.method, body: opts?.body })) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// ---------------- 夸克 / UC ----------------

test('夸克：code=0 且有 stoken → ok；假链 41006 → bad；41008 → locked；未知码 → 降级', async () => {
  await withMockFetch(
    (_url, opts) => {
      const pwdId = JSON.parse(opts.body ?? '{}').pwd_id;
      if (pwdId === 'realid') return jsonResponse({ status: 200, code: 0, message: 'ok', data: { stoken: 'xx' } });
      if (pwdId === 'deadid') return jsonResponse({ status: 404, code: 41006, message: '分享不存在' });
      if (pwdId === 'lockid') return jsonResponse({ status: 403, code: 41008, message: '需要提取码' });
      if (pwdId === 'weird') return jsonResponse({ status: 400, code: 99, message: '奇怪错误' });
      return jsonResponse({ status: 500, code: 500, message: 'server error' });
    },
    async () => {
      assert.deepEqual(await checkQuarkApi('https://pan.quark.cn/s/realid', ''), { state: 'ok', summary: '链接有效' });
      assert.deepEqual(await checkQuarkApi('https://pan.quark.cn/s/deadid', ''), { state: 'bad', summary: '分享不存在' });
      assert.deepEqual(await checkQuarkApi('https://pan.quark.cn/s/lockid', ''), { state: 'locked', summary: '需要提取码' });
      assert.equal(await checkQuarkApi('https://pan.quark.cn/s/weird', ''), null, '未知错误码必须降级而非误判失效');
      assert.equal(await checkQuarkApi('https://pan.quark.cn/s/nomatch', ''), null);
    },
  );
});

test('UC：同夸克码表；无 s/ 路径 → 降级', async () => {
  await withMockFetch(
    (_url, opts) => {
      const pwdId = JSON.parse(opts.body ?? '{}').pwd_id;
      if (pwdId === 'ucgood') return jsonResponse({ code: 0, data: { stoken: 's' } });
      return jsonResponse({ code: 41006, message: '分享不存在' });
    },
    async () => {
      assert.equal((await checkUcApi('https://drive.uc.cn/s/ucgood', ''))?.state, 'ok');
      assert.equal((await checkUcApi('https://drive.uc.cn/s/ucfake', ''))?.state, 'bad');
      assert.equal(await checkUcApi('https://drive.uc.cn/other', ''), null);
    },
  );
});

test('夸克/UC：请求异常或非 JSON 响应（风控页）→ 返回 null 而非失效', async () => {
  await withMockFetch(
    () => {
      throw new Error('network down');
    },
    async () => {
      assert.equal(await checkQuarkApi('https://pan.quark.cn/s/realid', ''), null);
    },
  );
  await withMockFetch(
    () => new Response('<html>challenge</html>', { status: 200 }),
    async () => {
      assert.equal(await checkUcApi('https://drive.uc.cn/s/realid', ''), null);
    },
  );
});

// ---------------- 百度 ----------------

test('百度：正确码 → verify 0 + randsk + list 0 → ok；错码 -9 → locked；假链 105 → bad；风控 9019 → 降级', async () => {
  await withMockFetch(
    (url) => {
      if (url.includes('/share/verify')) {
        if (url.includes('surl=goodlink')) return jsonResponse({ errno: 0, randsk: 'RANSK%3D' });
        if (url.includes('surl=wrongpw')) return jsonResponse({ errno: -9 });
        if (url.includes('surl=deadlink')) return jsonResponse({ errno: 105 });
        return jsonResponse({ errno: -62 });
      }
      if (url.includes('/share/list')) {
        if (url.includes('shorturl=goodlink')) return jsonResponse({ errno: 0, list: [{ fs_id: 1 }] });
        if (url.includes('shorturl=risked')) return jsonResponse({ errno: 9019, errmsg: 'need verify' });
        return jsonResponse({ errno: 0, list: [] });
      }
      throw new Error('unexpected url ' + url);
    },
    async () => {
      assert.equal((await checkBaiduApi('https://pan.baidu.com/s/1goodlink?pwd=8888', '8888'))?.state, 'ok');
      assert.deepEqual(await checkBaiduApi('https://pan.baidu.com/s/1wrongpw?pwd=9999', '9999'), {
        state: 'locked',
        summary: '提取码错误或缺失',
      });
      assert.deepEqual(await checkBaiduApi('https://pan.baidu.com/s/1deadlink?pwd=8888', '8888'), {
        state: 'bad',
        summary: '链接失效',
      });
      const risked = await checkBaiduApi('https://pan.baidu.com/s/1risked?pwd=8888', '8888');
      assert.equal(risked, null, '9019 风控必须降级页面探测');
    },
  );
});

test('百度：surl 前导 1 剥离（/s/1abc → surl=abc）', async () => {
  let seenSurl = '';
  await withMockFetch(
    (url) => {
      if (url.includes('/share/verify')) {
        seenSurl = new URL(url).searchParams.get('surl') ?? '';
        return jsonResponse({ errno: 0, randsk: 'x' });
      }
      return jsonResponse({ errno: 0, list: [{}] });
    },
    async () => {
      await checkBaiduApi('https://pan.baidu.com/s/1AbCdEfG?pwd=8888', '8888');
      assert.equal(seenSurl, 'AbCdEfG', 'verify 接口的 surl 必须去掉前导 1');
    },
  );
});

// ---------------- 阿里 ----------------

test('阿里：有效 → ok；带码 → locked；NotFound.ShareLink → bad；限流码 → 降级', async () => {
  await withMockFetch(
    (url, opts) => {
      const shareId = JSON.parse(opts.body ?? '{}').share_id ?? new URL(url).searchParams.get('share_id');
      if (shareId === 'aliveid') return jsonResponse({ share_name: '阿凡达', file_count: 1, has_pwd: false });
      if (shareId === 'pwdid') return jsonResponse({ share_name: 'x', file_count: 1, has_pwd: true });
      if (shareId === 'deadid') return jsonResponse({ code: 'NotFound.ShareLink', message: 'cannot be found' }, 404);
      if (shareId === 'cancelid') return jsonResponse({ code: 'ShareLink.Cancelled', message: 'cancelled' }, 400);
      if (shareId === 'rateid') return jsonResponse({ code: 'TooManyRequests.Requests', message: 'exceed limit' }, 429);
      return jsonResponse({ code: 'Unknown.Code', message: '?' });
    },
    async () => {
      assert.equal((await checkAliyunApi('https://www.alipan.com/s/aliveid', ''))?.state, 'ok');
      assert.equal((await checkAliyunApi('https://www.aliyundrive.com/s/pwdid', ''))?.state, 'locked');
      assert.equal((await checkAliyunApi('https://www.alipan.com/s/deadid', ''))?.state, 'bad');
      assert.equal((await checkAliyunApi('https://www.alipan.com/s/cancelid', ''))?.state, 'bad');
      assert.equal(await checkAliyunApi('https://www.alipan.com/s/rateid', ''), null, '限流风控降级');
      assert.equal(await checkAliyunApi('https://www.alipan.com/s/weirdid', ''), null, '未知码降级');
    },
  );
});

// ---------------- 115 ----------------

test('115：state=true → ok；4100008 访问码错误 → locked；990002 参数错误 → bad', async () => {
  await withMockFetch(
    (url) => {
      if (url.includes('share_code=good')) return jsonResponse({ state: true, error: '', errno: 0, data: { list: [{}], count: 1 } });
      if (url.includes('share_code=wrongpw')) return jsonResponse({ state: false, error: '访问码错误', errno: 4100008 });
      if (url.includes('share_code=fake')) return jsonResponse({ state: false, error: '参数错误。', errno: 990002 });
      if (url.includes('share_code=cancelled')) return jsonResponse({ state: false, error: '分享已取消', errno: 4100010 });
      return jsonResponse({ state: false, error: '' });
    },
    async () => {
      assert.equal((await check115Api('https://115cdn.com/s/good?password=b952', 'b952'))?.state, 'ok');
      assert.equal((await check115Api('https://115.com/s/wrongpw?password=zz', 'zz'))?.state, 'locked');
      assert.equal((await check115Api('https://115cdn.com/s/fake?password=b952', 'b952'))?.state, 'bad');
      assert.equal((await check115Api('https://115cdn.com/s/cancelled?password=b952', 'b952'))?.state, 'bad');
      assert.equal(await check115Api('https://115cdn.com/s/empty', ''), null, '无 error 无数据 → 降级');
    },
  );
});

// ---------------- 123 ----------------

test('123：code=0 → ok；HasPwd → locked；5104 已失效 / 5107 不存在 → bad；格式异常 → bad', async () => {
  await withMockFetch(
    (url) => {
      if (url.includes('sharekey=alive')) return jsonResponse({ code: 0, data: { ShareName: 'x', HasPwd: false, Expired: false } });
      if (url.includes('sharekey=pwded')) return jsonResponse({ code: 0, data: { HasPwd: true, Expired: false } });
      if (url.includes('sharekey=expired')) return jsonResponse({ code: 0, data: { HasPwd: false, Expired: true } });
      if (url.includes('sharekey=dead')) return jsonResponse({ code: 5104, message: '分享链接已失效' });
      if (url.includes('sharekey=gone')) return jsonResponse({ code: 5107, message: '分享页面不存在' });
      if (url.includes('sharekey=badfmt')) return jsonResponse({ code: 400, message: 'ShareKey格式异常' });
      return jsonResponse({ code: 403, message: 'Forbidden' });
    },
    async () => {
      assert.equal((await check123Api('https://www.123pan.com/s/alivekey', ''))?.state, 'ok');
      assert.equal((await check123Api('https://www.123pan.com/s/pwdedkey', ''))?.state, 'locked');
      assert.equal((await check123Api('https://www.123pan.com/s/expiredkey', ''))?.state, 'bad');
      assert.equal((await check123Api('https://www.123pan.com/s/deadkey', ''))?.state, 'bad');
      assert.equal((await check123Api('https://123684.com/s/gonekey', ''))?.state, 'bad');
      assert.equal((await check123Api('https://123684.com/s/badfmtkey', ''))?.state, 'bad');
      assert.equal(await check123Api('https://123684.com/s/riskedkey', ''), null, '未知码降级');
    },
  );
});

// ---------------- 天翼 ----------------

test('天翼：shareVO XML → ok；error XML ShareInfoNotFound → bad；带访问码请求形态正确', async () => {
  let seenShareCode = '';
  await withMockFetch(
    (url) => {
      if (url.includes('/getShareInfoByCodeV2')) {
        seenShareCode = new URL(url).searchParams.get('shareCode') ?? '';
        if (seenShareCode.includes('goodcode')) {
          return new Response(
            '<?xml version="1.0"?><shareVO><shareId>123</shareId><fileName>阿凡达</fileName><needAccessCode>0</needAccessCode></shareVO>',
            { status: 200 },
          );
        }
        if (seenShareCode.includes('fakecode')) {
          return new Response('<?xml version="1.0"?><error><code>ShareInfoNotFound</code><message>ShareInfoNotFound</message></error>', {
            status: 400,
          });
        }
        if (seenShareCode.includes('needcode')) {
          return new Response('<?xml version="1.0"?><error><code>InvalidSessionKey</code><message>请输入访问码</message></error>', {
            status: 400,
          });
        }
        return new Response('<html>blocked</html>', { status: 200 });
      }
      throw new Error('unexpected ' + url);
    },
    async () => {
      assert.equal((await checkTianyiApi('https://cloud.189.cn/t/goodcode', ''))?.state, 'ok');
      assert.equal((await checkTianyiApi('https://cloud.189.cn/t/fakecode', ''))?.state, 'bad');
      assert.equal((await checkTianyiApi('https://cloud.189.cn/t/needcode', ''))?.state, 'locked');
      assert.equal(await checkTianyiApi('https://cloud.189.cn/t/blocked', ''), null);
      await checkTianyiApi('https://cloud.189.cn/t/goodcode', 'ab12');
      assert.ok(seenShareCode.includes('（访问码：ab12）'), '密码盘 shareCode 参数须拼「（访问码：xxx）」');
    },
  );
});

// ---------------- 迅雷 ----------------

test('迅雷：share_status OK → ok；PASS_CODE_ERROR → locked；invalid_argument → bad；captcha 风控 → 降级', async () => {
  await withMockFetch(
    (url) => {
      if (url.includes('captcha/init')) return jsonResponse({ captcha_token: 'tok', url: '' });
      if (url.includes('share_id=goodxl')) return jsonResponse({ share_status: 'OK', file_num: '1', files: [{}] });
      if (url.includes('share_id=wrongpwxl')) return jsonResponse({ share_status: 'PASS_CODE_ERROR' });
      if (url.includes('share_id=fakexl'))
        return jsonResponse({ error: 'invalid_argument', error_code: 3, error_description: '请求参数错误' }, 400);
      if (url.includes('share_id=ratexl'))
        return jsonResponse({ error: 'captcha_invalid', error_code: 9, error_description: '验证码无效' }, 400);
      if (url.includes('share_id=captchaFail'))
        return jsonResponse({ share_status: 'SENSITIVE_RESOURCE', share_status_text: '' });
      throw new Error('unexpected ' + url);
    },
    async () => {
      assert.equal((await checkXunleiApi('https://pan.xunlei.com/s/goodxl?pwd=59k8', '59k8'))?.state, 'ok');
      assert.equal((await checkXunleiApi('https://pan.xunlei.com/s/wrongpwxl?pwd=zzzz', 'zzzz'))?.state, 'locked');
      assert.equal((await checkXunleiApi('https://pan.xunlei.com/s/fakexl', ''))?.state, 'bad');
      assert.equal(await checkXunleiApi('https://pan.xunlei.com/s/ratexl', ''), null, 'captcha 风控降级');
      assert.equal((await checkXunleiApi('https://pan.xunlei.com/s/captchaFail', ''))?.state, 'bad', 'SENSITIVE_RESOURCE 判失效');
    },
  );
});

// ---------------- 移动 139（AES 加解密） ----------------

const MOBILE_KEY = Buffer.from('PVGDwmcvfs1uV3d1', 'utf8');

function mobileEncryptForTest(plain: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-128-cbc', MOBILE_KEY, iv);
  return Buffer.concat([iv, cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
}

test('移动 139：resultCode=0 → ok；外链不存在 → bad；请求体为可解密的 AES 载荷', async () => {
  await withMockFetch(
    (url, opts) => {
      // 请求体是 JSON 字符串包裹的 base64(iv+AES 密文)，须能用同一 key 解密回明文
      const body = JSON.parse(opts.body ?? '""') as string;
      const raw = Buffer.from(body, 'base64');
      const decipher = createDecipheriv('aes-128-cbc', MOBILE_KEY, raw.subarray(0, 16));
      const plain = JSON.parse(
        Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]).toString('utf8'),
      ) as { getOutLinkInfoReq: { linkID: string } };
      assert.ok(plain.getOutLinkInfoReq?.linkID, '加密请求体必须携带 linkID');
      const resp =
        plain.getOutLinkInfoReq.linkID === 'zzNOTREAL'
          ? { resultCode: '200000727', desc: '外链不存在/外链被分享者取消' }
          : { resultCode: '0', data: { nodNum: 1, caLst: [] } };
      return new Response(mobileEncryptForTest(JSON.stringify(resp)), { status: 200 });
    },
    async () => {
      assert.equal((await checkMobileApi('https://yun.139.com/shareweb/#/w/i/2u8ojgnV1Gpf7', ''))?.state, 'ok');
    },
  );
});

test('移动 139：假链 resultCode 非 0 + 外链不存在 → bad', async () => {
  await withMockFetch(
    () => {
      const fake = mobileEncryptForTest(JSON.stringify({ resultCode: '200000727', desc: '外链不存在/外链被分享者取消' }));
      return new Response(fake, { status: 200 });
    },
    async () => {
      assert.equal((await checkMobileApi('https://yun.139.com/shareweb/#/w/i/zzNOTREAL', ''))?.state, 'bad');
    },
  );
});

// ---------------- 分发器与降级 ----------------

test('分发器：pikpak/guangya/未知类型 → null（走页面探测）；magnet/ed2k unsupported 不变', async () => {
  assert.equal(await checkNetdiskApi('pikpak', 'https://toapp.mypikpak.com/toapp?__add_url=magnet:abc', ''), null);
  assert.equal(await checkNetdiskApi('guangya', 'https://www.guangyapan.com/s/xxx', ''), null);
  assert.equal(await checkNetdiskApi('whatever', 'https://example.com/s/x', ''), null);
});

test('checkLinks 集成：API 判定优先（checked_via=api:xx），API 网络故障降级页面探测（checked_via=page）', async () => {
  await withMockFetch(
    (url) => {
      // 夸克 API 网络故障
      if (url.includes('drive-h.quark.cn')) throw new Error('api down');
      // 页面探测命中 404 → bad
      if (url === 'https://pan.quark.cn/s/degradetest') return new Response('not found page', { status: 404 });
      return new Response('ok', { status: 200 });
    },
    async () => {
      const { results } = await checkLinks([
        { disk_type: 'quark', url: 'https://pan.quark.cn/s/degradetest' },
        { disk_type: 'magnet', url: 'magnet:?xt=urn:btih:35d6c97de5cf4afa473dfc6b0ff90697e2d769bf' },
      ]);
      const degraded = results.find((r) => r.disk_type === 'quark');
      assert.equal(degraded?.state, 'bad');
      assert.equal(degraded?.checked_via, 'page', 'API 故障必须降级页面探测');
      const magnet = results.find((r) => r.disk_type === 'magnet');
      assert.equal(magnet?.state, 'unsupported');
    },
  );
});

test('checkLinks 集成：API 判定生效时返回 checked_via=api:xx 且字段结构向后兼容', async () => {
  await withMockFetch(
    (url) => {
      if (url.includes('drive-h.quark.cn')) return jsonResponse({ status: 200, code: 0, message: 'ok', data: { stoken: 's' } });
      if (url.includes('pc-api.uc.cn')) return jsonResponse({ status: 404, code: 41006, message: '分享不存在' });
      throw new Error('unexpected ' + url);
    },
    async () => {
      const { results } = await checkLinks([
        { disk_type: 'quark', url: 'https://pan.quark.cn/s/apilivetest' },
        { disk_type: 'uc', url: 'https://drive.uc.cn/s/apideadtest' },
      ]);
      const quark = results.find((r) => r.disk_type === 'quark');
      assert.equal(quark?.state, 'ok');
      assert.equal(quark?.checked_via, 'api:quark');
      assert.ok(quark?.summary && quark?.checked_at && quark?.expires_at && quark?.normalized_url, '既有字段保持');
      const uc = results.find((r) => r.disk_type === 'uc');
      assert.equal(uc?.state, 'bad');
      assert.equal(uc?.checked_via, 'api:uc');
    },
  );
});
