// Generate the full-system architecture diagram (style of the hand-polished original:
// group boxes, captions under icons, legend, lock = least-privilege IAM).
// Run: node scripts/gen-architecture.js <icons-base.svg>
const fs = require('fs');

const src = fs.readFileSync(process.argv[2] || 'docs/architecture-icons-base.svg', 'utf8');
const hrefs = [...src.matchAll(/<image href="(data:[^"]+)"/g)].map((m) => m[1]);
if (hrefs.length < 12) throw new Error(`expected 12 icons, got ${hrefs.length}`);

const [CLOUD, REGION, USERS, APIGW, LAMBDA, , , DDB, , , S3, CW] = hrefs;

// ổ khóa vàng = IAM role tối thiểu cho từng function
const lock = (x, y) => `
  <rect x="${x}" y="${y + 5}" width="14" height="10" rx="2" fill="#B8860B"/>
  <path d="M ${x + 3} ${y + 5} v -3 a 4 4 0 0 1 8 0 v 3" fill="none" stroke="#B8860B" stroke-width="2"/>`;

const ROWS = { movies: 200, auth: 330, social: 460, rooms: 590, ws: 720, sync: 850 };

const lambda = (y, name, desc, mid) => `
  <image href="${LAMBDA}" x="930" y="${y}" width="72" height="72"/>
  <text x="966" y="${y + 88}" text-anchor="middle" font-size="11.5" font-weight="bold" fill="#232f3e">AWS Lambda</text>
  <text x="966" y="${y + 102}" text-anchor="middle" font-size="10" fill="#555">${name}</text>
  <text x="966" y="${y + 115}" text-anchor="middle" font-size="9" fill="#777">${desc}</text>
  <line x1="1002" y1="${mid}" x2="1195" y2="${mid}" stroke="#0E7C7B" stroke-width="1.4" marker-end="url(#aht)"/>
  ${lock(1130, mid - 10)}`;

const ext = (x, color, title, sub) => `
  <rect x="${x}" y="1080" width="220" height="56" fill="#fff" stroke="${color}" stroke-width="1.5" stroke-dasharray="5 3"/>
  <text x="${x + 110}" y="1103" text-anchor="middle" font-size="11.5" font-weight="bold" fill="${color}">${title}</text>
  <text x="${x + 110}" y="1120" text-anchor="middle" font-size="9.5" fill="#555">${sub}</text>`;

// đường nối từ đáy nhóm Compute xuống box dịch vụ ngoài, ghi rõ function gọi
const extLink = (xDrop, xBox, color, marker, label) => `
  <polyline points="${xDrop},975 ${xDrop},1040 ${xBox},1040 ${xBox},1075" fill="none" stroke="${color}" stroke-width="1.3" stroke-dasharray="4 3" marker-end="url(#${marker})"/>
  <text x="${xDrop + 8}" y="1033" font-size="9" fill="${color}">${label}</text>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1900 1180" font-family="Segoe UI, Arial, sans-serif">
  <defs>
    <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#232f3e"/></marker>
    <marker id="ahred" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#D13212"/></marker>
    <marker id="aht" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#0E7C7B"/></marker>
    <marker id="ahg" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#6AA84F"/></marker>
    <marker id="ahp" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#E7157B"/></marker>
    <marker id="ahb" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#C7511F"/></marker>
  </defs>

  <rect width="1900" height="1180" fill="#ffffff"/>
  <text x="950" y="36" text-anchor="middle" font-size="22" font-weight="bold" fill="#232f3e">Cinemax — Full Serverless Architecture on AWS</text>

  <!-- AWS Cloud -->
  <rect x="460" y="60" width="1280" height="980" fill="none" stroke="#232f3e" stroke-width="1.6"/>
  <image href="${CLOUD}" x="460" y="60" width="36" height="36"/>
  <text x="504" y="84" font-size="14" font-weight="bold" fill="#232f3e">AWS Cloud</text>

  <!-- Region -->
  <rect x="500" y="118" width="1200" height="880" fill="none" stroke="#147EBA" stroke-width="1.3" stroke-dasharray="7 4"/>
  <image href="${REGION}" x="500" y="118" width="28" height="28"/>
  <text x="536" y="137" font-size="13" font-weight="bold" fill="#147EBA">ap-southeast-1 (Singapore)</text>

  <!-- Users + App -->
  <image href="${USERS}" x="315" y="250" width="56" height="56"/>
  <text x="343" y="325" text-anchor="middle" font-size="12" font-weight="bold" fill="#232f3e">Users</text>
  <line x1="343" y1="332" x2="343" y2="394" stroke="#D13212" stroke-width="1.6" marker-end="url(#ahred)"/>
  <rect x="263" y="400" width="160" height="64" rx="6" fill="#fff" stroke="#232f3e" stroke-width="1.4"/>
  <text x="343" y="427" text-anchor="middle" font-size="12.5" font-weight="bold" fill="#232f3e">Cinemax App</text>
  <text x="343" y="444" text-anchor="middle" font-size="10" fill="#555">Flutter · Android</text>

  <!-- API Gateway REST -->
  <image href="${APIGW}" x="565" y="390" width="72" height="72"/>
  <text x="601" y="478" text-anchor="middle" font-size="11.5" font-weight="bold" fill="#232f3e">Amazon API Gateway</text>
  <text x="601" y="492" text-anchor="middle" font-size="9.5" fill="#555">REST · /api/*</text>

  <!-- API Gateway WebSocket -->
  <image href="${APIGW}" x="565" y="620" width="72" height="72"/>
  <text x="601" y="708" text-anchor="middle" font-size="11.5" font-weight="bold" fill="#232f3e">Amazon API Gateway</text>
  <text x="601" y="722" text-anchor="middle" font-size="9.5" fill="#555">WebSocket · realtime</text>

  <!-- EventBridge -->
  <rect x="565" y="850" width="72" height="72" rx="7" fill="#E7157B"/>
  <circle cx="601" cy="886" r="17" fill="none" stroke="#fff" stroke-width="2.4"/>
  <path d="M 601 876 v 10 l 7 5" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  <path d="M 601 864 v -5 M 601 908 v 5 M 579 886 h -5 M 623 886 h 5" stroke="#fff" stroke-width="2"/>
  <text x="601" y="938" text-anchor="middle" font-size="11.5" font-weight="bold" fill="#232f3e">Amazon EventBridge</text>
  <text x="601" y="952" text-anchor="middle" font-size="9.5" fill="#555">cron 02:00 hằng đêm</text>

  <!-- ===== Serverless Compute group ===== -->
  <rect x="830" y="150" width="280" height="825" fill="none" stroke="#ED7100" stroke-width="1.4" stroke-dasharray="8 5"/>
  <text x="845" y="175" font-size="13" font-weight="bold" fill="#ED7100">Serverless Compute</text>
  <text x="845" y="190" font-size="10" fill="#ED7100">Node.js 22 · arm64</text>

  ${lambda(ROWS.movies, 'cinemax-movies', 'catalog · hot · ingest · cast', ROWS.movies + 36)}
  ${lambda(ROWS.auth, 'cinemax-auth', 'OTP · Google · JWT · avatar', ROWS.auth + 36)}
  ${lambda(ROWS.social, 'cinemax-social', 'bookmark · saved · comment', ROWS.social + 36)}
  ${lambda(ROWS.rooms, 'cinemax-watchrooms', 'phòng xem chung (REST)', ROWS.rooms + 36)}
  ${lambda(ROWS.ws, 'cinemax-watchroom-ws', 'sync play/pause realtime', ROWS.ws + 36)}
  ${lambda(ROWS.sync, 'cinemax-sync', 'phim mới hằng đêm', ROWS.sync + 36)}

  <!-- ===== Data Layer group ===== -->
  <rect x="1200" y="150" width="290" height="825" fill="none" stroke="#C925D1" stroke-width="1.4" stroke-dasharray="8 5"/>
  <text x="1215" y="175" font-size="13" font-weight="bold" fill="#C925D1">Data Layer</text>
  <text x="1215" y="190" font-size="10" fill="#C925D1">DynamoDB · on-demand + S3</text>

  <image href="${DDB}" x="1310" y="290" width="72" height="72"/>
  <text x="1346" y="378" text-anchor="middle" font-size="11.5" font-weight="bold" fill="#232f3e">DynamoDB — 7 bảng</text>
  <text x="1346" y="392" text-anchor="middle" font-size="9" fill="#555">movies (GSI: slug, category)</text>
  <text x="1346" y="404" text-anchor="middle" font-size="9" fill="#555">users · bookmarks · saved</text>
  <text x="1346" y="416" text-anchor="middle" font-size="9" fill="#555">comments · rooms · connections</text>

  <image href="${S3}" x="1310" y="640" width="72" height="72"/>
  <text x="1346" y="728" text-anchor="middle" font-size="11.5" font-weight="bold" fill="#232f3e">Amazon S3</text>
  <text x="1346" y="742" text-anchor="middle" font-size="9" fill="#555">cinemax-posters · avatar</text>
  <text x="1346" y="754" text-anchor="middle" font-size="9" fill="#555">public read: posters/* only</text>

  <!-- CloudWatch -->
  <image href="${CW}" x="1580" y="430" width="72" height="72"/>
  <text x="1616" y="518" text-anchor="middle" font-size="11.5" font-weight="bold" fill="#232f3e">CloudWatch</text>
  <text x="1616" y="532" text-anchor="middle" font-size="9.5" fill="#555">logs · metrics</text>
  <text x="1616" y="544" text-anchor="middle" font-size="9.5" fill="#555">5XX alarm</text>

  <!-- External services (ngoài AWS Cloud) -->
  ${ext(640, '#C7511F', 'kkphim API (phimapi.com)', 'nguồn phim · tìm kiếm · chi tiết')}
  ${ext(900, '#0d253f', 'TMDB API', 'trending · diễn viên · rating')}
  ${ext(1160, '#D93025', 'Gmail SMTP', 'email OTP xác minh')}

  <!-- ===== Lines ===== -->
  <!-- App -> REST GW -->
  <line x1="423" y1="426" x2="560" y2="426" stroke="#D13212" stroke-width="1.6" marker-end="url(#ahred)"/>
  <text x="448" y="418" font-size="9.5" fill="#D13212">HTTPS / JSON</text>
  <!-- App <-> WS GW -->
  <polyline points="343,464 343,656 560,656" fill="none" stroke="#D13212" stroke-width="1.6" marker-end="url(#ahred)" marker-start="url(#ahred)"/>
  <text x="370" y="648" font-size="9.5" fill="#D13212">wss · xem chung</text>

  <!-- REST GW -> 4 lambdas -->
  <path d="M 637 412 L 925 238" stroke="#232f3e" stroke-width="1.3" fill="none" marker-end="url(#ah)"/>
  <text x="755" y="310" font-size="9.5" fill="#555">/api/movies/*</text>
  <path d="M 637 422 L 925 366" stroke="#232f3e" stroke-width="1.3" fill="none" marker-end="url(#ah)"/>
  <text x="755" y="382" font-size="9.5" fill="#555">/api/auth/*</text>
  <path d="M 637 436 L 925 494" stroke="#232f3e" stroke-width="1.3" fill="none" marker-end="url(#ah)"/>
  <text x="740" y="478" font-size="9.5" fill="#555">/api/bookmarks · saved · comments</text>
  <path d="M 637 448 L 925 622" stroke="#232f3e" stroke-width="1.3" fill="none" marker-end="url(#ah)"/>
  <text x="740" y="560" font-size="9.5" fill="#555">/api/watch-rooms</text>
  <!-- WS GW <-> ws lambda -->
  <line x1="637" y1="668" x2="925" y2="756" stroke="#232f3e" stroke-width="1.3" marker-end="url(#ah)" marker-start="url(#ah)"/>

  <!-- EventBridge -> sync -->
  <line x1="637" y1="886" x2="925" y2="886" stroke="#E7157B" stroke-width="1.5" marker-end="url(#ahp)"/>
  <text x="755" y="878" font-size="9.5" fill="#E7157B">trigger</text>

  <!-- poster/avatar: movies + auth + sync -> S3 (gân xanh lá riêng, lệch dưới đường teal) -->
  <line x1="1002" y1="${ROWS.movies + 56}" x2="1160" y2="${ROWS.movies + 56}" stroke="#6AA84F" stroke-width="1.2" stroke-dasharray="4 3"/>
  <line x1="1002" y1="${ROWS.auth + 56}" x2="1160" y2="${ROWS.auth + 56}" stroke="#6AA84F" stroke-width="1.2" stroke-dasharray="4 3"/>
  <line x1="1002" y1="${ROWS.sync + 56}" x2="1160" y2="${ROWS.sync + 56}" stroke="#6AA84F" stroke-width="1.2" stroke-dasharray="4 3"/>
  <polyline points="1160,${ROWS.movies + 56} 1160,${ROWS.sync + 56}" fill="none" stroke="#6AA84F" stroke-width="1.2" stroke-dasharray="4 3"/>
  <line x1="1160" y1="676" x2="1305" y2="676" stroke="#6AA84F" stroke-width="1.3" stroke-dasharray="4 3" marker-end="url(#ahg)"/>
  <text x="1190" y="668" font-size="9.5" fill="#6AA84F">poster · avatar</text>

  <!-- App -> S3 (GET posters, vòng đáy) -->
  <polyline points="303,464 303,1010 1240,1010 1240,712 1305,690" fill="none" stroke="#6AA84F" stroke-width="1.2" stroke-dasharray="6 4" marker-end="url(#ahg)"/>
  <text x="330" y="1002" font-size="9.5" fill="#6AA84F">GET posters (HTTPS)</text>

  <!-- logs: compute group -> CloudWatch (vòng trên) -->
  <polyline points="1110,165 1110,100 1616,100 1616,425" fill="none" stroke="#E7157B" stroke-width="1.2" stroke-dasharray="4 3" marker-end="url(#ahp)"/>
  <text x="1250" y="93" font-size="9.5" fill="#E7157B">logs · metrics from all functions</text>

  <!-- 3 dịch vụ ngoài: nối thẳng từ đáy nhóm Compute, ghi rõ function gọi -->
  ${extLink(850, 750, '#C7511F', 'ahb', 'movies · sync')}
  ${extLink(966, 1010, '#0d253f', 'ah', 'movies · sync')}
  ${extLink(1082, 1270, '#D93025', 'ahred', 'auth')}

  <!-- Legend -->
  <text x="100" y="880" font-size="12.5" font-weight="bold" fill="#232f3e">Legend</text>
  <line x1="100" y1="900" x2="135" y2="900" stroke="#D13212" stroke-width="1.6"/><text x="143" y="904" font-size="10" fill="#555">user traffic</text>
  <line x1="100" y1="922" x2="135" y2="922" stroke="#232f3e" stroke-width="1.3"/><text x="143" y="926" font-size="10" fill="#555">API routing</text>
  <line x1="100" y1="944" x2="135" y2="944" stroke="#0E7C7B" stroke-width="1.4"/><text x="143" y="948" font-size="10" fill="#555">data access</text>
  <line x1="100" y1="966" x2="135" y2="966" stroke="#6AA84F" stroke-width="1.2" stroke-dasharray="4 3"/><text x="143" y="970" font-size="10" fill="#555">static content (poster · avatar)</text>
  <line x1="100" y1="988" x2="135" y2="988" stroke="#E7157B" stroke-width="1.2" stroke-dasharray="4 3"/><text x="143" y="992" font-size="10" fill="#555">observability / schedule</text>
  <line x1="100" y1="1010" x2="135" y2="1010" stroke="#C7511F" stroke-width="1.2" stroke-dasharray="4 3"/><text x="143" y="1014" font-size="10" fill="#555">external API</text>
  ${lock(100, 1026)}<text x="143" y="1038" font-size="10" fill="#555">least-privilege IAM role per function</text>
</svg>
`;

fs.writeFileSync('docs/architecture-aws.svg', svg, 'utf8');
console.log('written docs/architecture-aws.svg');
