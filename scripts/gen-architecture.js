// Generate the full-system architecture diagram reusing the official AWS icons
// embedded in the earlier hand-polished SVG. Run: node scripts/gen-architecture.js <icons.svg>
const fs = require('fs');

const src = fs.readFileSync(process.argv[2] || 'docs/architecture-icons-base.svg', 'utf8');
const hrefs = [...src.matchAll(/<image href="(data:[^"]+)"/g)].map((m) => m[1]);
if (hrefs.length < 12) throw new Error(`expected 12 icons, got ${hrefs.length}`);

const [CLOUD, REGION, USERS, APIGW, LAMBDA, , , DDB, , , S3, CW] = hrefs;

const lambda = (y, name, d1, d2) => `
  <image href="${LAMBDA}" x="520" y="${y}" width="56" height="56"/>
  <text x="592" y="${y + 18}" font-size="11" font-weight="bold" fill="#232f3e">${name}</text>
  <text x="592" y="${y + 32}" font-size="9" fill="#555">${d1}</text>
  ${d2 ? `<text x="592" y="${y + 44}" font-size="9" fill="#555">${d2}</text>` : ''}`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1320 940" font-family="Segoe UI, Arial, sans-serif">
  <defs>
    <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#232f3e"/></marker>
    <marker id="ahp" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#E7157B"/></marker>
    <marker id="ahr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#D93025"/></marker>
    <marker id="ahg" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#7AA116"/></marker>
    <marker id="ahb" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#C7511F"/></marker>
  </defs>

  <rect width="1320" height="940" fill="#ffffff"/>
  <text x="660" y="32" text-anchor="middle" font-size="20" font-weight="bold" fill="#232f3e">Cinemax — Full Serverless Architecture on AWS</text>

  <!-- AWS Cloud frame -->
  <rect x="195" y="52" width="1100" height="800" fill="none" stroke="#232f3e" stroke-width="1.6"/>
  <image href="${CLOUD}" x="195" y="52" width="34" height="34"/>
  <text x="237" y="74" font-size="13.5" font-weight="bold" fill="#232f3e">AWS Cloud</text>

  <!-- Region -->
  <rect x="225" y="105" width="1040" height="715" fill="none" stroke="#147EBA" stroke-width="1.3" stroke-dasharray="7 4"/>
  <image href="${REGION}" x="225" y="105" width="26" height="26"/>
  <text x="259" y="123" font-size="12.5" font-weight="bold" fill="#147EBA">ap-southeast-1 (Singapore)</text>

  <!-- Client -->
  <image href="${USERS}" x="60" y="300" width="56" height="56"/>
  <text x="88" y="375" text-anchor="middle" font-size="11.5" font-weight="bold" fill="#232f3e">Users</text>
  <text x="88" y="392" text-anchor="middle" font-size="11" font-weight="bold" fill="#232f3e">Cinemax App</text>
  <text x="88" y="406" text-anchor="middle" font-size="9.5" fill="#555">Flutter · Android</text>

  <!-- API Gateway REST -->
  <image href="${APIGW}" x="280" y="232" width="60" height="60"/>
  <text x="310" y="310" text-anchor="middle" font-size="11" font-weight="bold" fill="#232f3e">Amazon API Gateway</text>
  <text x="310" y="323" text-anchor="middle" font-size="9.5" fill="#555">REST · /api/*</text>

  <!-- API Gateway WebSocket -->
  <image href="${APIGW}" x="280" y="496" width="60" height="60"/>
  <text x="310" y="574" text-anchor="middle" font-size="11" font-weight="bold" fill="#232f3e">Amazon API Gateway</text>
  <text x="310" y="587" text-anchor="middle" font-size="9.5" fill="#555">WebSocket · realtime</text>

  <!-- Lambdas -->
  ${lambda(138, 'cinemax-movies', 'catalog · search · filter · hot · cast', 'on-demand ingest (kho tự lớn)')}
  ${lambda(238, 'cinemax-auth', 'register · OTP · login · Google · JWT', 'profile · avatar lên S3')}
  ${lambda(338, 'cinemax-social', 'bookmarks · saved · comments', 'profanity filter (lọc từ nhạy cảm)')}
  ${lambda(438, 'cinemax-watchrooms', 'tạo / vào / đóng phòng (REST)', '')}
  ${lambda(528, 'cinemax-watchroom-ws', 'sync play/pause/seek · đổi tập', '')}
  ${lambda(658, 'cinemax-sync', 'phim mới mỗi đêm từ kkphim', 'backup poster về S3')}

  <!-- EventBridge (vẽ theo phong cách icon chính chủ) -->
  <rect x="300" y="656" width="56" height="56" rx="6" fill="#E7157B"/>
  <circle cx="328" cy="684" r="13" fill="none" stroke="#fff" stroke-width="2"/>
  <path d="M 328 676 v 8 l 5 4" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="M 328 667 v -4 M 328 701 v 4 M 311 684 h -4 M 345 684 h 4" stroke="#fff" stroke-width="1.7"/>
  <text x="328" y="730" text-anchor="middle" font-size="11" font-weight="bold" fill="#232f3e">Amazon EventBridge</text>
  <text x="328" y="743" text-anchor="middle" font-size="9.5" fill="#555">cron 02:00 hằng đêm</text>

  <!-- DynamoDB -->
  <image href="${DDB}" x="850" y="160" width="60" height="60"/>
  <text x="942" y="175" font-size="11.5" font-weight="bold" fill="#232f3e">Amazon DynamoDB — 7 bảng</text>
  <text x="942" y="191" font-size="9.5" fill="#555">movies (GSI: slug, category) · users (PK: email)</text>
  <text x="942" y="204" font-size="9.5" fill="#555">bookmarks · saved-movies · comments</text>
  <text x="942" y="217" font-size="9.5" fill="#555">rooms · connections (WebSocket)</text>

  <!-- S3 -->
  <image href="${S3}" x="850" y="325" width="60" height="60"/>
  <text x="942" y="345" font-size="11.5" font-weight="bold" fill="#232f3e">Amazon S3</text>
  <text x="942" y="361" font-size="9.5" fill="#555">500+ poster &amp; thumbnail · avatar người dùng</text>
  <text x="942" y="374" font-size="9.5" fill="#555">public read: posters/* only</text>

  <!-- CloudWatch -->
  <image href="${CW}" x="850" y="465" width="60" height="60"/>
  <text x="942" y="488" font-size="11.5" font-weight="bold" fill="#232f3e">Amazon CloudWatch</text>
  <text x="942" y="504" font-size="9.5" fill="#555">logs của 6 Lambda · metrics · 5XX alarm</text>

  <!-- External services -->
  <rect x="1080" y="640" width="178" height="54" fill="#fff" stroke="#C7511F" stroke-width="1.5" stroke-dasharray="5 3"/>
  <text x="1169" y="662" text-anchor="middle" font-size="11.5" font-weight="bold" fill="#C7511F">kkphim API (phimapi.com)</text>
  <text x="1169" y="678" text-anchor="middle" font-size="9.5" fill="#555">nguồn phim · tìm kiếm · chi tiết</text>

  <rect x="1080" y="712" width="178" height="48" fill="#fff" stroke="#0d253f" stroke-width="1.5" stroke-dasharray="5 3"/>
  <text x="1169" y="732" text-anchor="middle" font-size="11.5" font-weight="bold" fill="#0d253f">TMDB API</text>
  <text x="1169" y="747" text-anchor="middle" font-size="9.5" fill="#555">ảnh diễn viên · điểm rating</text>

  <rect x="1080" y="778" width="178" height="48" fill="#fff" stroke="#D93025" stroke-width="1.5" stroke-dasharray="5 3"/>
  <text x="1169" y="798" text-anchor="middle" font-size="11.5" font-weight="bold" fill="#D93025">Gmail SMTP</text>
  <text x="1169" y="813" text-anchor="middle" font-size="9.5" fill="#555">email OTP xác minh</text>

  <!-- Arrows -->
  <polyline points="116,318 310,318 310,228" fill="none" stroke="#232f3e" stroke-width="1.4" marker-end="url(#ah)"/>
  <text x="170" y="310" font-size="9.5" fill="#555">HTTPS / JSON</text>
  <polyline points="116,344 250,344 250,526 276,526" fill="none" stroke="#232f3e" stroke-width="1.4" marker-end="url(#ah)" marker-start="url(#ah)"/>
  <text x="150" y="424" font-size="9.5" fill="#555">wss (xem chung)</text>

  <path d="M 340 250 L 515 170" stroke="#232f3e" stroke-width="1.3" fill="none" marker-end="url(#ah)"/>
  <line x1="340" y1="262" x2="515" y2="264" stroke="#232f3e" stroke-width="1.3" marker-end="url(#ah)"/>
  <path d="M 340 274 L 515 360" stroke="#232f3e" stroke-width="1.3" fill="none" marker-end="url(#ah)"/>
  <path d="M 340 284 L 515 458" stroke="#232f3e" stroke-width="1.3" fill="none" marker-end="url(#ah)"/>
  <line x1="340" y1="528" x2="515" y2="550" stroke="#232f3e" stroke-width="1.3" marker-end="url(#ah)" marker-start="url(#ah)"/>

  <polyline points="576,162 800,162 800,184 845,184" fill="none" stroke="#232f3e" stroke-width="1.2" marker-end="url(#ah)"/>
  <polyline points="576,262 800,262 800,200" fill="none" stroke="#232f3e" stroke-width="1.2"/>
  <polyline points="576,362 800,362 800,228" fill="none" stroke="#232f3e" stroke-width="1.2"/>
  <polyline points="576,462 800,462 800,386" fill="none" stroke="#232f3e" stroke-width="1.2"/>
  <polyline points="576,552 800,552 800,486" fill="none" stroke="#232f3e" stroke-width="1.2"/>
  <polyline points="576,682 800,682 800,584" fill="none" stroke="#232f3e" stroke-width="1.2"/>

  <polyline points="818,326 845,350" fill="none" stroke="#7AA116" stroke-width="1.2" stroke-dasharray="4 3" marker-end="url(#ahg)"/>
  <text x="775" y="318" font-size="9" fill="#7AA116">poster · avatar</text>

  <line x1="356" y1="684" x2="515" y2="684" stroke="#E7157B" stroke-width="1.4" marker-end="url(#ahp)"/>
  <text x="432" y="676" text-anchor="middle" font-size="9.5" fill="#E7157B">trigger</text>

  <polyline points="576,696 1040,696 1040,667 1075,667" fill="none" stroke="#C7511F" stroke-width="1.2" stroke-dasharray="4 3" marker-end="url(#ahb)"/>
  <text x="828" y="689" font-size="9" fill="#C7511F">lấy phim mới · tìm kiếm fallback</text>

  <polyline points="648,186 668,186 668,618 1060,618 1060,736 1075,736" fill="none" stroke="#0d253f" stroke-width="1.1" stroke-dasharray="4 3" marker-end="url(#ah)"/>

  <polyline points="548,294 548,318 492,318 492,802 1075,802" fill="none" stroke="#D93025" stroke-width="1.1" stroke-dasharray="4 3" marker-end="url(#ahr)"/>
  <text x="700" y="795" font-size="9" fill="#D93025">send OTP</text>

  <polyline points="700,608 880,608 880,529" fill="none" stroke="#E7157B" stroke-width="1.1" stroke-dasharray="3 3" marker-end="url(#ahp)"/>
  <text x="742" y="601" font-size="9" fill="#E7157B">logs từ tất cả Lambda</text>
</svg>
`;

fs.writeFileSync('docs/architecture-aws.svg', svg, 'utf8');
console.log('written docs/architecture-aws.svg with official icons');
