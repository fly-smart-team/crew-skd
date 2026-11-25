# Google 캘린더 연결 준비 (한 번만)

독립 웹앱이 내 구글 캘린더에 일정을 넣으려면 Google OAuth 클라이언트 ID가 필요합니다. 무료이고 10분쯤 걸립니다.

## 1. 프로젝트 만들기
1. https://console.cloud.google.com 에 접속해 상단에서 **새 프로젝트**를 만듭니다 (이름 예: `crew-skd`).
2. **API 및 서비스 → 라이브러리**에서 **Google Calendar API**를 찾아 **사용**을 누릅니다.
   - 로그북(`logbook/`)의 구글 드라이브 동기화를 쓰려면 같은 곳에서 **Google Drive API**도 **사용**으로 켭니다.

## 2. OAuth 동의 화면
1. **API 및 서비스 → OAuth 동의 화면**(또는 **Google 인증 플랫폼**)으로 갑니다.
2. 사용자 유형 **외부**, 앱 이름 `crew-skd`, 지원 이메일은 본인 메일.
3. **테스트 사용자**에 본인 구글 계정을 추가합니다. 게시(Publish)하지 않고 테스트 상태로 두면 됩니다.
   - 테스트 상태에서는 "확인되지 않은 앱" 경고가 뜹니다. **고급 → crew-skd(으)로 이동**을 누르면 됩니다.

## 3. 클라이언트 ID 만들기
1. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**
2. 애플리케이션 유형: **웹 애플리케이션**
3. **승인된 JavaScript 원본**에 앱 주소를 넣습니다:
   - `https://fly-smart-team.github.io`
   - (내 PC에서 시험할 때) `http://localhost:8080`
4. 리디렉션 URI는 비워 둡니다.
5. 만들어진 `…apps.googleusercontent.com` 값을 복사합니다.

## 4. 앱에 넣기
둘 중 하나:
- `config.js`의 `googleClientId`에 붙여 넣고 커밋 (모든 기기에서 바로 사용)
- 앱 화면 아래 **설정**에 붙여 넣고 저장 (그 브라우저에만 저장)

클라이언트 ID는 비밀값이 아니라 공개 저장소에 올려도 됩니다. 클라이언트 **보안 비밀(secret)** 은 이 앱에 필요 없으니 어디에도 넣지 마세요.

## 요청하는 권한
- `calendar.events` — 일정 만들기, 중복 확인을 위한 일정 읽기
- `calendar.calendarlist.readonly` — 넣을 캘린더 목록 보기
- `drive.file` (로그북) — 로그북이 만든 `pilot-logbook.json` 파일만 읽고 쓰기. 드라이브의 다른 파일은 볼 수 없습니다.

같은 클라이언트 ID를 두 앱이 같이 씁니다. 로그북은 `https://fly-smart-team.github.io/crew-skd/logbook/`에서 열리므로 승인된 JavaScript 원본을 따로 추가할 필요가 없습니다.
OAuth 동의 화면이 "테스트" 상태라면 **데이터 액세스(범위)**에 `drive.file`을 추가해 두면 로그인 화면이 깔끔해집니다(안 해도 동작은 합니다).
