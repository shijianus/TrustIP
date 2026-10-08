// The destination catalog behind the homepage's site-routing test.
//
// Three kinds of row, and the difference between them is the difference
// between three different questions:
//
//   international — services that belong to no country (developer infrastructure,
//       cloud and CDN, music, payment, shopping). A row here answers "can this
//       browser reach the world's common services, and from which address?",
//       so it is labelled 国际, never a flag. Attributing GitHub to the United
//       States would be a statement about GitHub's paperwork rather than about
//       the visitor's network.
//   country — services that only matter to people in one place. Which of
//       these get probed is decided by `common/split-profile.js`: every country an
//       address of this visitor's actually resolved to, plus one more guessed from
//       their clock, keyboard and language. Someone whose exit, leak and keyboard
//       all say Iran should see Digikala and Snapp, not Shopee. Within a pack the
//       written order is the order its people use these sites, because the table
//       shows them in that order.
//   world — the traffic ranking's ten biggest sites, timed rather than traced.
//       This is the floor under the whole test: if these answer, the network
//       works, whatever the split did to the rows above.
//
// One country row is asked of everyone rather than only of the countries the
// profile picked: `EXIT_CANARIES`, because the split that makes a machine look
// foreign is exactly the thing that would keep its own country out of the pick.
//
// `method` is a preference, not a promise. `auto` asks the destination for the
// address it saw — Cloudflare's `/cdn-cgi/trace` echoes it as plain text with a
// wildcard CORS header, so the measurement happens in the visitor's browser
// along their real path and this server carries none of it. Only a
// Cloudflare-fronted host can answer, and most national services are not one:
// fewer than a third of the 157 destinations below reply to the echo, so a row
// that cannot report an address falls back to timing the connection and says
// which of the two it actually measured. That is why the method is resolved at
// run time against the live destination rather than baked in here — a host moves
// off an edge, or the visitor's network blocks it, and the row's answer changes
// underneath us.
//
// Every host below was probed before being added. A `000` from one vantage is
// not a dead domain (NAVER answers only Korean addresses, and half of Russia
// refuses a Chinese one), which is exactly the kind of thing this test is for.

// A group is a row's coloured chip. Twelve labels, reused by every pack, so
// adding a destination costs no new copy in six languages.
export const SPLIT_GROUPS = [
    'AI', 'Social', 'Dev', 'Cloud', 'Music', 'Pay', 'Shop', 'Media', 'News', 'Gov', 'Search', 'Speed',
];

// The committed PNG that stands for a destination, named for its host.
//
// Icons are shipped rather than hot-linked from each site for two reasons: the
// table is a reachability test, and on a network that blocks the destination the
// icon has to still draw — and a privacy tool that asks a third party for every
// logo it displays is leaking the very list it just measured. Same-origin files
// under `public/favicons/`, fetched at build time by `pnpm fetch-favicons`.
//
// The name is the host's first label with `www.` dropped, which reads well for
// most of the catalog and is unique by construction across distinct hosts. The
// table below is where that rule breaks: five brands that put their service on a
// shared sub-domain (`web.telegram.org` and `web.whatsapp.com` would both be
// `web`), a handful whose first label is a number or a single letter, and the
// country storefronts that all answer to the same name.
const ICON_NAMES = {
    'web.telegram.org': 'telegram',
    'web.whatsapp.com': 'whatsapp',
    'amazon.in': 'amazon-in',
    'amazon.eg': 'amazon-eg',
    'www.yahoo.co.jp': 'yahoo-jp',
    'shopee.sg': 'shopee-sg',
    'shopee.com.my': 'shopee-my',
    'shopee.co.th': 'shopee-th',
    'shopee.vn': 'shopee-vn',
    'shopee.co.id': 'shopee-id',
    'lazada.sg': 'lazada-sg',
    'lazada.com.my': 'lazada-my',
    'lazada.co.th': 'lazada-th',
    'lazada.vn': 'lazada-vn',
    'www.cloudflare.com': 'cloudflare',
    'www.cloudflare-cn.com': 'cloudflare-cn',
    'speed.cloudflare.com': 'cloudflare-speed',
    'one.one.one.one': 'cloudflare-dns',
    '1.1.1.1': 'cloudflare-ip',
    'www3.nhk.or.jp': 'nhk',
    'i.ua': 'i-ua',
    'on.cc': 'oncc',
    'www.163.com': 'netease',
    'www.gov.uk': 'govuk',
    'www.gob.mx': 'gob-mx',
};

// Slug-shaped so it can be a file name without further escaping.
export const iconId = (host) => {
    const named = ICON_NAMES[host];
    if (named) return named;
    return String(host).replace(/^www\./, '').split('.')[0].toLowerCase().replace(/[^a-z0-9-]/g, '-');
};

// Which group leads the table.//
// Someone who came to check whether their network reaches the AI services they
// pay for reads a different table from someone checking their bank. The base
// order puts AI first because, for this tool's audience, that is overwhelmingly
// the question; the per-country overrides below are for the networks where the
// evidence says the order is otherwise, and they are chosen from the two
// countries the visitor's own signals rank highest — so it is a guess about what
// a person in that place came here for, never a claim about the person.
//
// A group missing from an override falls to the end of that list rather than
// vanishing: the order is a preference about precedence, not a filter.
const GROUP_ORDER_BASE = [
    'AI', 'Social', 'Search', 'Dev', 'Cloud', 'Media', 'Music', 'Pay', 'Shop', 'News', 'Gov', 'Speed',
];

const GROUP_ORDER_BY_COUNTRY = {
    // AI access is the reason this test gets run here, ahead of everything.
    CN: ['AI', 'Search', 'Social', 'Media', 'Dev', 'Cloud', 'News', 'Shop', 'Pay', 'Music', 'Gov', 'Speed'],
    HK: ['AI', 'Search', 'Social', 'News', 'Media', 'Dev', 'Pay', 'Shop', 'Cloud', 'Music', 'Gov', 'Speed'],
    TW: ['AI', 'Search', 'Social', 'News', 'Media', 'Dev', 'Shop', 'Pay', 'Cloud', 'Music', 'Gov', 'Speed'],
    // Where the split is for work rather than for access, the developer
    // infrastructure leads.
    IN: ['Dev', 'AI', 'Cloud', 'Search', 'Social', 'Shop', 'Pay', 'Media', 'Music', 'News', 'Gov', 'Speed'],
    US: ['AI', 'Dev', 'Cloud', 'Social', 'Search', 'Pay', 'Shop', 'Media', 'News', 'Music', 'Gov', 'Speed'],
    RU: ['Social', 'Search', 'News', 'Dev', 'AI', 'Media', 'Cloud', 'Pay', 'Shop', 'Music', 'Gov', 'Speed'],
    IR: ['AI', 'Search', 'Social', 'News', 'Shop', 'Media', 'Dev', 'Pay', 'Cloud', 'Music', 'Gov', 'Speed'],
};

// Rank of a group for one profile: the first override that applies wins, and a
// group an override never mentions sorts after everything it did.
const groupRank = (group, countries) => {
    for (const cc of countries) {
        const order = GROUP_ORDER_BY_COUNTRY[cc];
        if (!order) continue;
        const at = order.indexOf(group);
        if (at >= 0) return at;
    }
    const at = GROUP_ORDER_BASE.indexOf(group);
    return at >= 0 ? GROUP_ORDER_BASE.length + at : GROUP_ORDER_BASE.length * 2;
};

// [name, host, group]
export const INTERNATIONAL_PACK = [
    // AI — the reason a great many people pay for a split tunnel at all.
    // ChatGPT is not repeated here: it is world #5 and the floor below already
    // asks it, and one host answering twice in the same table is a row wasted.
    ['Claude', 'claude.ai', 'AI'],
    ['Perplexity', 'www.perplexity.ai', 'AI'],
    ['Mistral', 'mistral.ai', 'AI'],
    ['Gemini', 'gemini.google.com', 'AI'],
    ['Copilot', 'copilot.microsoft.com', 'AI'],
    ['DeepSeek', 'chat.deepseek.com', 'AI'],

    // Social and messaging — including the ones a network blocks precisely
    // because they leak the address a caller would rather keep.
    ['X', 'x.com', 'Social'],
    ['Discord', 'discord.com', 'Social'],
    ['Medium', 'medium.com', 'Social'],
    ['Telegram', 'web.telegram.org', 'Social'],
    ['Signal', 'signal.org', 'Social'],
    ['LinkedIn', 'www.linkedin.com', 'Social'],

    // Developer infrastructure
    ['GitHub', 'github.com', 'Dev'],
    ['npm Registry', 'registry.npmjs.org', 'Dev'],
    ['Stack Overflow', 'stackoverflow.com', 'Dev'],
    ['Hugging Face', 'huggingface.co', 'Dev'],

    // Cloud and CDN — what a page's assets actually come from.
    ['Cloudflare', 'www.cloudflare.com', 'Cloud'],
    ['jsDelivr', 'cdn.jsdelivr.net', 'Cloud'],
    ['AWS', 'aws.amazon.com', 'Cloud'],
    ['Google Cloud', 'cloud.google.com', 'Cloud'],

    // Music
    ['Spotify', 'open.spotify.com', 'Music'],
    ['Apple Music', 'music.apple.com', 'Music'],

    // Financial services and payment
    ['PayPal', 'www.paypal.com', 'Pay'],
    ['Wise', 'wise.com', 'Pay'],
    ['Coinbase', 'coinbase.com', 'Pay'],

    // Shopping
    ['Amazon', 'www.amazon.com', 'Shop'],
    ['eBay', 'www.ebay.com', 'Shop'],
    ['Shopify', 'shopify.com', 'Shop'],

    // Streaming
    ['Netflix', 'netflix.com', 'Media'],
    ['Crunchyroll', 'www.crunchyroll.com', 'Media'],
    ['Disney+', 'www.disneyplus.com', 'Media'],

    // Speed — the measurement of the measurement.
    ['Cloudflare Speedtest', 'speed.cloudflare.com', 'Speed'],
    ['Cloudflare DNS', 'one.one.one.one', 'Speed'],
].map(([name, host, group]) => ({ name, host, group, icon: iconId(host), kind: 'international', method: 'auto' }));

// National destinations, four to eleven per country. These are probed for every
// country the visitor's own addresses named and for one more the signals guess, so
// the whole table stays readable — the catalog is deep, the screen is not.
//
// Written order is usage order, not category order: the table renders these rows as
// they are listed here, so the first row of a pack is the site a person in that
// country opens before any of the others.
//
// Cloudflare's China network is not listed here even though it is a Chinese
// destination: it is asked of every visitor as a canary (`EXIT_CANARIES`), and a
// second copy in the CN pack would be one host answering twice in one table.
//
// [name, host, group]
const COUNTRY_ROWS = {
    // Written in the order the people here actually use them, which is the order
    // the table shows them in: a visitor with a mainland exit is asking "does my
    // own internet still work, and does the rest", and the answer starts where they
    // type first thing. The old head of this list was a chipmaker's corporate site.
    CN: [
        ['百度', 'www.baidu.com', 'Search'],
        ['微信', 'weixin.qq.com', 'Social'],
        ['抖音', 'www.douyin.com', 'Media'],
        ['淘宝', 'www.taobao.com', 'Shop'],
        ['微博', 'weibo.com', 'Social'],
        ['腾讯', 'www.qq.com', 'News'],
        ['京东', 'www.jd.com', 'Shop'],
        ['今日头条', 'www.toutiao.com', 'News'],
        ['哔哩哔哩', 'bilibili.com', 'Media'],
        ['支付宝', 'www.alipay.com', 'Pay'],
        ['网易', 'www.163.com', 'News'],
    ],
    TW: [
        ['PTT', 'ptt.cc', 'Social'],
        ['Yahoo奇摩購物', 'eprice.com.tw', 'Shop'],
        ['中央通訊社', 'www.cw.com.tw', 'News'],
        ['RTI 央廣', 'rti.org.tw', 'News'],
        ['政府入口網', 'www.taiwan.gov.tw', 'Gov'],
    ],
    HK: [
        ['東方日報', 'on.cc', 'News'],
        ['有線寬頻', 'www.i-cable.com', 'Media'],
        ['明報', 'www.mingpao.com', 'News'],
        ['The Standard', 'www.thestandard.com.hk', 'News'],
        ['香港電台', 'rthk.org.hk', 'Media'],
        ['金管局', 'www.hkma.gov.hk', 'Gov'],
    ],
    JP: [
        ['Yahoo! JAPAN', 'www.yahoo.co.jp', 'Shop'],
        ['NHK', 'www3.nhk.or.jp', 'News'],
        ['楽天市場', 'www.rakuten.co.jp', 'Shop'],
        ['ニコニコ動画', 'www.nicovideo.jp', 'Media'],
    ],
    KR: [
        ['네이버', 'www.naver.com', 'Social'],
        ['다음', 'www.daum.net', 'Social'],
        ['연합뉴스', 'www.yna.co.kr', 'News'],
        ['카카오', 'www.kakaocorp.com', 'Social'],
        ['NH농협', 'www.nonghyup.com', 'Pay'],
    ],
    SG: [
        ['Shopee', 'shopee.sg', 'Shop'],
        ['Lazada', 'lazada.sg', 'Shop'],
        ['CNA', 'www.channelnewsasia.com', 'News'],
        ['DBS', 'www.dbs.com.sg', 'Pay'],
    ],
    MY: [
        ['Shopee', 'shopee.com.my', 'Shop'],
        ['Lazada', 'lazada.com.my', 'Shop'],
        ['Astro', 'astro.com.my', 'Media'],
        ['公积金局', 'www.kwsp.gov.my', 'Gov'],
    ],
    TH: [
        ['Thairath', 'www.thairath.co.th', 'News'],
        ['Shopee', 'shopee.co.th', 'Shop'],
        ['ไทยพาณิชย์', 'www.scb.co.th', 'Pay'],
        ['Lazada', 'lazada.co.th', 'Shop'],
        ['Bangkok Post', 'www.bangkokpost.com', 'News'],
    ],
    VN: [
        ['VnExpress', 'vnexpress.net', 'News'],
        ['Tuổi Trẻ', 'tuoitre.vn', 'News'],
        ['Shopee', 'shopee.vn', 'Shop'],
        ['Vietcombank', 'www.vietcombank.com.vn', 'Pay'],
        ['Lazada', 'lazada.vn', 'Shop'],
    ],
    ID: [
        ['Detik', 'www.detik.com', 'News'],
        ['Kompas', 'kompas.com', 'News'],
        ['Tokopedia', 'www.tokopedia.com', 'Shop'],
        ['Shopee', 'shopee.co.id', 'Shop'],
        ['Blibli', 'www.blibli.com', 'Shop'],
        ['Bank Central Asia', 'www.bca.co.id', 'Pay'],
    ],
    IN: [
        ['The Hindu', 'www.thehindu.com', 'News'],
        ['Paytm', 'paytm.com', 'Pay'],
        ['Inshorts', 'inshorts.com', 'News'],
        ['Amazon.in', 'amazon.in', 'Shop'],
        ['IRCTC', 'www.irctc.co.in', 'Gov'],
    ],
    PK: [
        ['Dawn', 'www.dawn.com', 'News'],
        ['Jazz', 'jazz.com.pk', 'Social'],
        ['Daraz', 'daraz.pk', 'Shop'],
        ['PTV', 'www.ptv.com.pk', 'Media'],
    ],
    RU: [
        ['ВКонтакте', 'vk.com', 'Social'],
        ['Яндекс', 'yandex.ru', 'Search'],
        ['Mail.ru', 'mail.ru', 'Social'],
        ['Госуслуги', 'www.gosuslugi.ru', 'Gov'],
        ['Хабр', 'habr.com', 'Dev'],
        ['RUTUBE', 'rutube.ru', 'Media'],
    ],
    UA: [
        ['Українська правда', 'www.pravda.com.ua', 'News'],
        ['Український інтерес', 'i.ua', 'News'],
        ['LIGA.net', 'liga.net', 'News'],
        ['УКРНЕТ', 'www.ukr.net', 'Search'],
        ['ПриватБанк', 'privatbank.ua', 'Pay'],
    ],
    TR: [
        ['Sözcü', 'sozcu.com.tr', 'News'],
        ['ShiftDelete', 'shiftdelete.net', 'Dev'],
        ['n11', 'n11.com', 'Shop'],
        ['Hepsiburada', 'hepsiburada.com', 'Shop'],
        ['Türk Hava Yolları', 'www.turkishairlines.com', 'Shop'],
    ],
    IR: [
        ['Virgool', 'virgool.io', 'Social'],
        ['دیجی‌کالا', 'digikala.com', 'Shop'],
        ['اسنپ', 'snapp.ir', 'Shop'],
        ['ترب', 'torob.ir', 'Shop'],
        ['همراه اول', 'mci.ir', 'Social'],
    ],
    SA: [
        ['Arab News', 'arabnews.com', 'News'],
        ['أرقام', 'www.argaam.com', 'Pay'],
        ['stc', 'www.stc.com.sa', 'Social'],
        ['الراجحي', 'alrajhibank.com.sa', 'Pay'],
        ['السمرية', 'www.alsumaria.tv', 'Media'],
    ],
    EG: [
        ['اليوم السابع', 'www.youm7.com', 'News'],
        ['المصري اليوم', 'almasryalyoum.com', 'News'],
        ['فوري', 'fawry.com', 'Pay'],
        ['Amazon.eg', 'amazon.eg', 'Shop'],
    ],
    BR: [
        ['g1', 'g1.globo.com', 'News'],
        ['UOL', 'www.uol.com.br', 'News'],
        ['Mercado Livre', 'www.mercadolivre.com.br', 'Shop'],
        ['Nubank', 'nubank.com.br', 'Pay'],
        ['TechTudo', 'www.techtudo.com.br', 'Dev'],
    ],
    MX: [
        ['El Universal', 'www.eluniversal.com.mx', 'News'],
        ['Mercado Libre', 'www.mercadolibre.com.mx', 'Shop'],
        ['Gobierno de México', 'www.gob.mx', 'Gov'],
        ['Telcel', 'www.telcel.com', 'Social'],
    ],
    // The Western packs exist for the opposite reason from the others: nobody
    // split-routes to reach Germany, but a visitor whose clock, keyboard and
    // display language all say so is on a VPN, and "which of my exits is the
    // German one" is the same question asked from the other side. That decides
    // *which* hosts are in the list — the ones that answer differently to a
    // domestic and a foreign address — but not their order, which is usage like
    // every other pack: an American reading this table looks for Reddit first.
    US: [
        ['Reddit', 'www.reddit.com', 'Social'],
        ['The New York Times', 'www.nytimes.com', 'News'],
        ['USA.gov', 'www.usa.gov', 'Gov'],
        ['White House', 'www.whitehouse.gov', 'Gov'],
    ],
    GB: [
        ['BBC', 'www.bbc.co.uk', 'News'],
        ['GOV.UK', 'www.gov.uk', 'Gov'],
        ['The Guardian', 'www.theguardian.com', 'News'],
    ],
    DE: [
        ['tagesschau', 'www.tagesschau.de', 'News'],
        ['SPIEGEL', 'www.spiegel.de', 'News'],
        ['DIE ZEIT', 'www.zeit.de', 'News'],
    ],
    FR: [
        ['Ameli', 'www.ameli.fr', 'Gov'],
        ['service-public', 'www.service-public.fr', 'Gov'],
        ['franceinfo', 'www.francetvinfo.fr', 'News'],
        ['Le Monde', 'www.lemonde.fr', 'News'],
    ],
    ES: [
        ['RTVE', 'www.rtve.es', 'Media'],
        ['El Mundo', 'www.elmundo.es', 'News'],
        ['administración.gob.es', 'www.administracion.gob.es', 'Gov'],
    ],
    IT: [
        ['RAI', 'www.rai.it', 'Media'],
        ['Corriere della Sera', 'www.corriere.it', 'News'],
        ['Agenzia Entrate', 'www.agenziaentrate.gov.it', 'Gov'],
    ],
    CA: [
        ['CBC', 'www.cbc.ca', 'News'],
        ['Canada.ca', 'www.canada.ca', 'Gov'],
        ['Bell', 'www.bell.ca', 'Social'],
    ],
    AU: [
        ['ABC', 'www.abc.net.au', 'News'],
        ['news.com.au', 'www.news.com.au', 'News'],
        ['Telstra', 'www.telstra.com.au', 'Social'],
    ],
};

// Country code → rows. Names are written the way a local writes them, because
// these rows are shown to locals: an Iranian visitor reads «دیجی‌کالا» faster
// than "Digikala", and the mismatch itself is information.
export const COUNTRY_PACKS = Object.fromEntries(Object.entries(COUNTRY_ROWS).map(([cc, rows]) => [
    cc,
    rows.map(([name, host, group]) => ({ name, host, group, icon: iconId(host), kind: 'country', cc, method: 'auto' })),
]));

export const PACK_COUNTRIES = Object.keys(COUNTRY_PACKS);

export const hasPack = (cc) => Object.prototype.hasOwnProperty.call(COUNTRY_PACKS, cc);

// Destinations asked of every visitor, whatever the profile guessed.
//
// The split these rows exist to find hides the very signal that would find it: a
// proxy that makes a machine look American hands the scorer an American, the plan
// then holds no domestic rows, and the one destination that would have answered
// with the real address is never asked. The page then reports a single exit — an
// all-clear issued without having looked. So one mainland-fronted echo is asked
// unconditionally, and `www.cloudflare-cn.com` is the only such host found: it
// runs on Cloudflare's China network, so it answers `/cdn-cgi/trace` with a
// wildcard CORS header, and a rule list that sends `.cn` traffic direct — which
// is what creates the leak in the first place — sends this row down that path.
// Verified from inside a browser: it reports the mainland address while every
// other destination reports the overseas one.
//
// It is not a row that reads as broken for everybody else. Reachable from North
// America and North Asia (326 ms Buffalo, 86 ms Tokyo, 160 ms Singapore), it
// answers a non-splitting visitor with the same single address as the rest of the
// table, so its silence would mean the network does not reach it either.
//
// [name, host, group, cc]
export const EXIT_CANARIES = [
    ['Cloudflare China', 'www.cloudflare-cn.com', 'Cloud', 'CN'],
].map(([name, host, group, cc]) => ({ name, host, group, icon: iconId(host), kind: 'country', cc, method: 'auto' }));

// The ten biggest sites by traffic, timed from the browser.
//
// These are rows of the same table as every other, and they carry the same two
// chips: where they rank, and what kind of site they are. A group of `Speed`
// would describe the measurement rather than the destination — Google is a
// search engine however you probe it — so each one is labelled for what it is.
//
// The ranking (Similarweb/Semrush, late 2025 through early 2026) places two
// adult sites inside the top ten. They are dropped rather than probed — a tool
// this page sends requests to on someone's behalf has no business naming them in
// a visitor's browser history, access log or Referer chain — and the next
// general-interest sites by volume take their places. The rank is preserved so
// the row still reads as "world #6", not as an unexplained substitution.
//
// [rank, name, host, group]
export const WORLD_RANKING = [
    [1, 'Google', 'google.com', 'Search'],
    [2, 'YouTube', 'www.youtube.com', 'Media'],
    [3, 'Facebook', 'www.facebook.com', 'Social'],
    [4, 'Instagram', 'www.instagram.com', 'Social'],
    [5, 'ChatGPT', 'chatgpt.com', 'AI'],
    [7, 'WhatsApp', 'web.whatsapp.com', 'Social'],
    [9, 'Yahoo', 'www.yahoo.com', 'News'],
    [10, 'MSN', 'www.msn.com', 'News'],
    [11, 'TikTok', 'www.tiktok.com', 'Media'],
    [12, 'Wikipedia', 'www.wikipedia.org', 'Search'],
].map(([rank, name, host, group]) => ({ name, host, group, icon: iconId(host), kind: 'world', rank, method: 'ping' }));

// The latency thresholds and the homepage's own six-target strip live in
// `latency-probes.js`, which is what the frontend bundle is allowed to read. This
// file is the server's: nothing in it ships to the browser, because which
// destinations exist is part of how a visitor is placed.

// One work order: the world ranking, then the shared block, then the canaries
// that are asked regardless of any guess, then the picked countries' rows — all
// four in written order. Pure, so the same call from the same countries always
// produces the same table — and so the backend can hand a tool the identical
// order the page is running.
//
// The ranking leads because it is the only part of the table that means the same
// thing to every visitor: before any row below it can be read as "blocked" or
// "routed", the page has to establish that the network answers at all.
//
// The shared block and the national rows stay in two blocks rather than being
// merged into one group-sorted list. They answer different questions — "can I
// reach the world's common services" versus "can I reach the services *here*" —
// and a row interleaved between the two would read as belonging to whichever
// block it happened to land in.
//
// Only the shared block is re-sorted by group. A national pack is *written* in
// the order its people use it, so sorting it by category would undo the one
// piece of judgement that file carries: 百度 would fall behind whatever row
// happened to be filed under the leading heading.
export const buildPlan = (countries = []) => {
    const picked = [];
    for (const cc of countries) {
        if (hasPack(cc) && !picked.includes(cc)) picked.push(cc);
    }
    // Index first, then sort, so the sort is stable on catalog order: two rows in
    // the same group stay in the order they were written, which is the order that
    // puts the more-asked-about destination first.
    const byGroup = (rows) => rows
        .map((row, at) => ({ row, at }))
        .sort((a, b) => groupRank(a.row.group, picked) - groupRank(b.row.group, picked) || a.at - b.at)
        .map(({ row }) => row);

    const rows = [
        ...WORLD_RANKING,
        ...byGroup(INTERNATIONAL_PACK),
        ...EXIT_CANARIES,
        ...picked.flatMap((cc) => COUNTRY_PACKS[cc]),
    ];
    return { countries: picked, rows };
};
