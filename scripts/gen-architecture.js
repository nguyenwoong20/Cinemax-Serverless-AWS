// Generate the full-system architecture diagram reusing the official AWS icons
// embedded in the earlier hand-polished SVG. Run: node scripts/gen-architecture.js <icons.svg>
const fs = require('fs');

const src = fs.readFileSync(process.argv[2] || 'docs/architecture-icons-base.svg', 'utf8');
const hrefs = [...src.matchAll(/<image href="(data:[^"]+)"/g)].map((m) => m[1]);
if (hrefs.length < 12) throw new Error(`expected 12 icons, got ${hrefs.length}`);

const [CLOUD, REGION, USERS, APIGW, LAMBDA, , , DDB, , , S3, CW] = hrefs;

const lambda = (y, name, d1, d2) => `
  <image href="${LAMBDA}" x="520" y="${y}" width="56" height="56"/>
  <line x1="576" y1="${y + 28}" x2="584" y2="${y + 28}" stroke="#E7157B" stroke-width="1" stroke-dasharray="2 2"/>
  <text x="592" y="${y + 18}" font-size="11" font-weight="bold" fill="#232f3e">${name}</text>
  <text x="592" y="${y + 32}" font-size="9" fill="#555">${d1}</text>
  ${d2 ? `<text x="592" y="${y + 44}" font-size="9" fill="#555">${d2}</text>` : ''}`;

const external = (y, h, color, title, sub) => `
  <rect x="1095" y="${y}" width="195" height="${h}" fill="#fff" stroke="${color}" stroke-width="1.5" stroke-dasharray="5 3"/>
  <text x="1192" y="${y + 21}" text-anchor="middle" font-size="11.5" font-weight="bold" fill="${color}">${title}</text>
  <text x="1192" y="${y + 37}" text-anchor="middle" font-size="9.5" fill="#555">${sub}</text>`;

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
  <rect x="195" y="52" width="865" height="800" fill="none" stroke="#232f3e" stroke-width="1.6"/>
  <image href="${CLOUD}" x="195" y="52" width="34" height="34"/>
  <text x="237" y="74" font-size="13.5" font-weight="bold" fill="#232f3e">AWS Cloud</text>

  <!-- Region -->
  <rect x="225" y="105" width="805" height="715" fill="none" stroke="#147EBA" stroke-width="1.3" stroke-dasharray="7 4"/>
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
  ${lambda(658, 'cinemax-sync', 'phim mới mỗi đêm từ kkphim', '')}

  <!-- EventBridge -->
  <rect x="300" y="656" width="56" height="56" rx="6" fill="#E7157B"/>
  <circle cx="328" cy="684" r="13" fill="none" stroke="#fff" stroke-width="2"/>
  <path d="M 328 676 v 8 l 5 4" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="M 328 667 v -4 M 328 701 v 4 M 311 684 h -4 M 345 684 h 4" stroke="#fff" stroke-width="1.7"/>
  <text x="328" y="730" text-anchor="middle" font-size="11" font-weight="bold" fill="#232f3e">Amazon EventBridge</text>
  <text x="328" y="743" text-anchor="middle" font-size="9.5" fill="#555">cron 02:00 hằng đêm</text>

  <!-- DynamoDB -->
  <image href="${DDB}" x="800" y="150" width="60" height="60"/>
  <text x="870" y="160" font-size="11.5" font-weight="bold" fill="#232f3e">Amazon DynamoDB</text>
  <text x="870" y="175" font-size="10" font-weight="bold" fill="#555">7 bảng · on-demand</text>
  <text x="870" y="191" font-size="9" fill="#555">movies (GSI: slug, category)</text>
  <text x="870" y="204" font-size="9" fill="#555">users · bookmarks · saved</text>
  <text x="870" y="217" font-size="9" fill="#555">comments · rooms · connections</text>

  <!-- S3 -->
  <image href="${S3}" x="800" y="320" width="60" height="60"/>
  <text x="870" y="338" font-size="11.5" font-weight="bold" fill="#232f3e">Amazon S3</text>
  <text x="870" y="354" font-size="9" fill="#555">500+ poster &amp; thumbnail</text>
  <text x="870" y="367" font-size="9" fill="#555">avatar người dùng</text>
  <text x="870" y="380" font-size="9" fill="#555">public read: posters/* only</text>

  <!-- CloudWatch -->
  <image href="${CW}" x="800" y="465" width="60" height="60"/>
  <text x="870" y="486" font-size="11.5" font-weight="bold" fill="#232f3e">Amazon CloudWatch</text>
  <text x="870" y="502" font-size="9" fill="#555">logs của 6 Lambda</text>
  <text x="870" y="515" font-size="9" fill="#555">metrics · 5XX alarm</text>

  <!-- External services (ngoài AWS Cloud) -->
  ${external(596, 52, '#0d253f', 'TMDB API', 'ảnh diễn viên · điểm rating')}
  ${external(668, 54, '#C7511F', 'kkphim API (phimapi.com)', 'nguồn phim · tìm kiếm · chi tiết')}
  ${external(742, 52, '#D93025', 'Gmail SMTP', 'email OTP xác minh')}

  <!-- ===== Arrows ===== -->
  <!-- client -> REST GW (vào cạnh trái icon, không đè chữ) -->
  <polyline points="116,318 240,318 240,262 276,262" fill="none" stroke="#232f3e" stroke-width="1.4" marker-end="url(#ah)"/>
  <text x="150" y="310" font-size="9.5" fill="#555">HTTPS / JSON</text>
  <!-- client <-> WS GW -->
  <polyline points="116,344 252,344 252,526 276,526" fill="none" stroke="#232f3e" stroke-width="1.4" marker-end="url(#ah)" marker-start="url(#ah)"/>
  <text x="150" y="430" font-size="9.5" fill="#555">wss (xem chung)</text>

  <!-- REST GW -> 4 lambdas -->
  <path d="M 340 250 L 515 170" stroke="#232f3e" stroke-width="1.3" fill="none" marker-end="url(#ah)"/>
  <line x1="340" y1="262" x2="515" y2="264" stroke="#232f3e" stroke-width="1.3" marker-end="url(#ah)"/>
  <path d="M 340 274 L 515 360" stroke="#232f3e" stroke-width="1.3" fill="none" marker-end="url(#ah)"/>
  <path d="M 340 284 L 515 458" stroke="#232f3e" stroke-width="1.3" fill="none" marker-end="url(#ah)"/>
  <!-- WS GW <-> ws lambda -->
  <line x1="340" y1="528" x2="515" y2="550" stroke="#232f3e" stroke-width="1.3" marker-end="url(#ah)" marker-start="url(#ah)"/>

  <!-- lambdas -> dynamodb (bus x=760) -->
  <polyline points="576,158 760,158 760,176 795,176" fill="none" stroke="#232f3e" stroke-width="1.2" marker-end="url(#ah)"/>
  <polyline points="576,250 760,250 760,194" fill="none" stroke="#232f3e" stroke-width="1.2"/>
  <polyline points="576,350 760,350 760,254" fill="none" stroke="#232f3e" stroke-width="1.2"/>
  <polyline points="576,450 760,450 760,386" fill="none" stroke="#232f3e" stroke-width="1.2"/>
  <polyline points="576,540 760,540 760,486" fill="none" stroke="#232f3e" stroke-width="1.2"/>
  <polyline points="576,670 760,670 760,576" fill="none" stroke="#232f3e" stroke-width="1.2"/>

  <!-- auth/sync -> S3 -->
  <polyline points="778,318 795,342" fill="none" stroke="#7AA116" stroke-width="1.2" stroke-dasharray="4 3" marker-end="url(#ahg)"/>
  <text x="726" y="312" font-size="9" fill="#7AA116">poster · avatar</text>

  <!-- logs: gom từ cột Lambda (đường gân x=584) -> CloudWatch -->
  <polyline points="584,166 584,608 830,608 830,529" fill="none" stroke="#E7157B" stroke-width="1.1" stroke-dasharray="3 3" marker-end="url(#ahp)"/>
  <text x="640" y="601" font-size="9" fill="#E7157B">logs từ tất cả Lambda</text>

  <!-- EventBridge -> sync -->
  <line x1="356" y1="684" x2="515" y2="684" stroke="#E7157B" stroke-width="1.4" marker-end="url(#ahp)"/>
  <text x="432" y="676" text-anchor="middle" font-size="9.5" fill="#E7157B">trigger</text>

  <!-- sync & movies -> kkphim (thẳng hàng) -->
  <line x1="576" y1="694" x2="1090" y2="694" stroke="#C7511F" stroke-width="1.2" stroke-dasharray="4 3" marker-end="url(#ahb)"/>
  <text x="800" y="687" font-size="9" fill="#C7511F">lấy phim mới · tìm kiếm fallback</text>

  <!-- movies -> TMDB -->
  <polyline points="660,150 680,150 680,128 1075,128 1075,622 1090,622" fill="none" stroke="#0d253f" stroke-width="1.1" stroke-dasharray="4 3" marker-end="url(#ah)"/>
  <text x="985" y="121" font-size="9" fill="#0d253f">cast · rating</text>

  <!-- auth -> gmail -->
  <polyline points="548,294 548,316 494,316 494,768 1090,768" fill="none" stroke="#D93025" stroke-width="1.1" stroke-dasharray="4 3" marker-end="url(#ahr)"/>
  <text x="700" y="761" font-size="9" fill="#D93025">send OTP</text>
</svg>
`;

fs.writeFileSync('docs/architecture-aws.svg', svg, 'utf8');
console.log('written docs/architecture-aws.svg with official icons');
