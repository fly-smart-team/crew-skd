# iCloud 동기화 켜기 (한 번만)

로그북을 각 조종사의 iCloud에 저장하려면 **Apple CloudKit**을 씁니다.
앱 운영자(저장소 주인)가 아래 설정을 **한 번만** 해 두면, 로그북을 쓰는 모든 사람이 각자 Apple 계정으로 로그인해서
**자기 iCloud 비공개 영역**에 저장합니다. 운영자도 다른 사람의 기록은 볼 수 없습니다.

> 이 안내의 메뉴 이름은 작성 시점 기준입니다. Apple 화면은 자주 바뀌니 이름이 조금 다를 수 있습니다.

## 필요한 것
- **Apple Developer Program** 가입 (개인, 연 $99) — https://developer.apple.com/programs/
- 30분 정도

## 1. iCloud 컨테이너 만들기
1. https://developer.apple.com/account → **Certificates, Identifiers & Profiles** → **Identifiers** → **+**
2. **iCloud Containers** 선택 → 설명 `Pilot Logbook`, 식별자 `iCloud.com.(본인 이름 등).pilotlogbook` → 등록
   - 이 값이 **컨테이너 ID**입니다 (예 `iCloud.com.jaesung.pilotlogbook`).

## 2. 저장 형식(스키마) 만들기
1. https://icloud.developer.apple.com → **CloudKit Database** → 방금 만든 컨테이너 선택
2. 환경 **Development** → **Schema** → **Record Types** → **+** → 이름 `LogbookBackup`
3. 필드 두 개 추가
   | 필드 이름 | 형식 |
   |---|---|
   | `file` | Asset |
   | `updated` | Int(64) |
4. 저장 후 **Deploy Schema Changes…** 로 **Production**에 반영

## 3. 웹용 API 토큰 만들기
1. 같은 CloudKit 화면에서 **Tokens & Keys**(또는 API Access) → **API Tokens** → **+**
2. 이름 `pilot-logbook-web`
3. **Sign in Callback**: `postMessage`
4. **Allowed Origins**(도메인 제한): `https://fly-smart-team.github.io`
   - 내 PC에서 시험하려면 `http://localhost:8080`도 추가
5. 만들어진 **토큰 값**을 복사

## 4. 앱에 넣기 (둘 중 하나)
- **모든 사람에게 적용 (추천)**: 저장소의 `config.js`에 넣고 커밋
  ```js
  window.SKD_CONFIG = {
    googleClientId: '…',
    cloudkit: {
      containerIdentifier: 'iCloud.com.jaesung.pilotlogbook',
      apiToken: '복사한 토큰',
      environment: 'production'
    }
  };
  ```
  웹용 API 토큰은 위 주소(Allowed Origins)에서만 쓸 수 있어서 공개 저장소에 둬도 됩니다. 실제 기록은 각자의 Apple 로그인 없이는 읽을 수 없습니다.
- **이 기기에서만**: 로그북 › 설정 › 동기화 › iCloud 칸에 컨테이너 ID와 API 토큰을 넣고 **iCloud 설정 저장**

## 5. 각 기기에서 로그인
로그북 › 설정 › 동기화 · 백업 › iCloud 칸의 **Apple 로그인 버튼**을 누릅니다.
- 한 번 로그인하면 유지됩니다 (구글처럼 1시간마다 다시 연결하지 않음).
- 개인 폰은 구글 + iCloud 둘 다, 회사 iPad는 iCloud만 연결해도 됩니다. 폰이 양쪽을 맞춰 주므로 모든 기기의 기록이 같아집니다.

## 문제가 생기면
- "iCloud 연결 스크립트를 불러오지 못했습니다": 인터넷 연결, 또는 회사 기기에서 `cdn.apple-cloudkit.com`이 막혀 있지 않은지 확인
- `AUTHENTICATION_FAILED` / 로그인 창이 안 뜸: API 토큰의 Allowed Origins에 앱 주소가 있는지, Sign in Callback이 postMessage인지 확인
- `BAD_REQUEST`, `NOT_FOUND`(레코드 형식): 2번 스키마를 **Production에 반영**했는지 확인. 시험 중에는 설정의 환경을 development로 바꿔 볼 수 있음
