# crew-skd

회사 월간 스케줄(MONTHLY SKD 엑셀, `.xls`)을 읽어 **내 비행 일정만** 구글 캘린더에 넣는 도구입니다.
엑셀은 브라우저 안에서만 읽고 서버로 보내지 않습니다.

## 구성

| 경로 | 설명 |
|---|---|
| `index.html`, `app.js`, `config.js` | **독립 웹앱.** Google 로그인 후 Calendar API로 직접 넣습니다. GitHub Pages로 배포. |
| `skd-core.js` | 엑셀 해석·일정 생성 공통 로직 (브라우저/Node 공용) |
| `claude-artifact/index.html` | Claude 아티팩트용 단일 파일 버전 (Claude의 Google Calendar 커넥터 사용) |
| `tests/` | 가상 승무원 데이터로 만든 예시 `.xls`와 테스트 |
| `docs/google-setup.md` | Google OAuth 클라이언트 ID 만드는 법 |
| `ios-logbook/` | **iPad 전자 로그북.** OOOI 화면 사진 자동 입력, iCloud 동기화, 구글 드라이브 백업. [ios-logbook/README.md](ios-logbook/README.md) |

> `claude-artifact/index.html`은 한 파일로 돌아가야 해서 해석 로직을 자체적으로 들고 있습니다. `skd-core.js`를 고치면 그쪽도 같이 맞춰 주세요.

## 독립 웹앱 쓰기

1. **GitHub Pages 켜기:** 저장소 **Settings → Pages → Build and deployment**에서 Source를 **Deploy from a branch**, Branch를 **main / (root)** 로 저장합니다.
   잠시 뒤 `https://fly-smart-team.github.io/crew-skd/` 에서 열립니다.
2. **Google 클라이언트 ID 준비:** [docs/google-setup.md](docs/google-setup.md) (처음 한 번)
3. 매달: 앱 열기 → **파일 선택** → 옵션 고르기 → **N건 캘린더에 추가**

내 PC에서 시험: `python3 -m http.server 8080` 후 `http://localhost:8080` (파일을 더블클릭해 `file://`로 열면 Google 로그인이 안 됩니다).

## 지원하는 스케줄 형식

```
EMPL : 100001        MONTH : 202612
DATE       FLIGHT  SHOW UP  SECTOR   STD       STA       EMPL    NAME    RANK  POSN TYP  POSN
12/01(화)  8236             CJU/CJJ  01 19:15  01 20:25  100001  홍길동  CAP   TL        C
12/01(화)                                                100002  김부기  F/O   TL        F
```

- `EMPL :` 옆의 사번으로 본인 일정만 골라냅니다.
- 편명 행 바로 아래의 빈 편명 행은 같은 편 승무원으로 묶습니다.
- `STD`/`STA`는 `일 시:분` 형식입니다. STA가 다음 날이거나 다음 달이어도 처리합니다.
- 숫자만 있는 편명에는 `OZ`를 붙입니다.
- 시각은 **한국 시간(Asia/Seoul)** 으로 넣습니다.

## 기능

- 구간별 또는 근무일별(하루 여러 편을 하나로 묶기)로 일정 생성
- 시작 시각: STD 또는 쇼업
- 설명란: 편명, STD/STA, 블록 시간, 함께 탄 승무원, 식별표 `[skd:사번:날짜:편명]`
- 식별표로 중복을 확인해 같은 일정은 다시 넣지 않음 (두 버전이 넣은 일정을 서로 알아봅니다)
- `.ics` 내보내기, 일정별 "구글에서 열기" 링크

## 개발

```
npm install
npm test                    # 해석 로직 테스트
node tests/make-fixture.js  # 예시 .xls 다시 만들기
```

실제 회사 스케줄 파일은 `.gitignore`로 막아 두었습니다. 공개 저장소이니 실명·사번이 담긴 파일은 올리지 마세요.
