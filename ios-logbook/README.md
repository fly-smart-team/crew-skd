# 조종사 전자 로그북 (iPad)

ACARS **AOC OOOI STATUS** 화면을 찍으면 OUT/OFF/ON/IN이 자동으로 입력되는 iPad 로그북입니다.
칸 구성은 회사 Flight Log(Date, A/C, HL, FLT NO, Route, IRR, Duty, R/O, R/I, Duty time, T/S, N/T, I/T, T/O, L/D)를 그대로 따릅니다.

## 무엇을 하나

| 기능 | 내용 |
|---|---|
| 사진 자동 입력 | iPad 내장 Vision으로 글자 인식 (**오프라인**). 편명, 출발/도착, OUT·OFF·ON·IN, BLOCK, FLIGHT를 읽음 |
| 검산 | 화면의 BLOCK(=IN−OUT)·FLIGHT(=ON−OFF)로 확인. 반사로 안 보인 값은 계산해서 채우고, 한 글자 오인식(예: 1↔4)은 하나로만 맞아떨어질 때 자동 수정 |
| 날짜 처리 | MCDU의 DATE는 사진 찍은 시점의 UTC 날짜이므로, IN부터 거꾸로 날짜를 붙임 (자정 넘김 처리). 로그북 날짜는 회사처럼 **한국 날짜** |
| 잘린 사진 | 오른쪽이 잘린 `VVT…` 같은 공항 코드는 공항 목록에서 하나로 정해지면 채우고 표시 |
| 자동 계산 | 블록·비행시간, **야간 시간**(대권 항로를 따라 1분 단위로 태양 고도 계산), 계기 시간(규칙 선택), 야간 이착륙 |
| 요약 | 누계(이월 누계 + 앱 기록), 이번 달, **최근 90일 이착륙**(비행/SIM, 유지 기한) |
| 저장 | iPad에 먼저 저장 → iCloud 로그인 시 자동 동기화 (SwiftData + CloudKit) |
| 백업 | 저장할 때마다 파일 앱에 JSON 자동 사본, JSON/CSV 내보내기 → **구글 드라이브** 등 아무 곳에나 저장, JSON 불러오기(합치기) |

## 저장 구조

```
 iPad (기본 저장소, 오프라인에서도 전부 동작)
   ├─ 인터넷 연결 시 ─▶ iCloud (CloudKit 비공개 DB, 자동 동기화)
   ├─ 저장할 때마다 ─▶ 파일 앱 › 나의 iPad › 로그북 › Backups/*.json (최근 30일)
   └─ 수동 내보내기 ─▶ Google Drive / iCloud Drive / 메일 … (JSON 백업, 회사 양식 CSV)
```

구글 드라이브를 실시간 동기화까지 하지 않은 이유: 두 클라우드를 동시에 동기화하면 기록이 엇갈릴 수 있어서,
iCloud 하나만 실시간 동기화하고 구글 드라이브는 백업 보관 용도로 썼습니다.

## 폴더

| 경로 | 내용 |
|---|---|
| `LogbookCore/` | 화면과 무관한 로직 (Swift 패키지). OOOI 화면 해석, 검산, 날짜, 야간, 90일, 백업/CSV. **테스트 포함** |
| `App/` | iPad 앱 (SwiftUI, SwiftData, Vision) |
| `project.yml` | Xcode 프로젝트 생성 설정 (XcodeGen) |

## 설치 (Mac 필요)

1. Mac에 **Xcode 15 이상**과 XcodeGen 설치: `brew install xcodegen`
2. 이 폴더에서 프로젝트 만들기:
   ```sh
   cd ios-logbook
   xcodegen generate
   open PilotLogbook.xcodeproj
   ```
3. `project.yml`에서 두 군데를 본인 것으로 바꾸고 다시 `xcodegen generate`:
   - `PRODUCT_BUNDLE_IDENTIFIER: com.example.pilotlogbook` → 예: `com.내이름.pilotlogbook`
   - `iCloud.com.example.pilotlogbook` → `iCloud.` + 위 번들 ID
4. Xcode › PilotLogbook 타깃 › Signing & Capabilities에서 **Team** 선택
   - iCloud(CloudKit) 동기화를 쓰려면 **Apple Developer Program(연 $99)** 계정이 필요합니다.
   - 무료 계정으로도 iPad에 설치해 쓸 수 있지만 iCloud 동기화는 꺼진 상태로 동작합니다(기기 저장 + 파일 백업은 그대로 됨). 무료 계정 설치본은 7일마다 다시 설치해야 합니다.
5. iPad를 연결하고 ▶ 실행. 계속 쓰려면 TestFlight로 올려 두는 것이 편합니다.

## 처음 쓸 때

1. **설정 › 이월 누계**에 회사 Flight Log의 Flight Summary 숫자(예: 총 8584:14, CAP 1954:12)와 기준일을 넣습니다.
2. **설정 › 기본값**에서 기종(A321), Duty(C)를 확인합니다.
3. 비행 후 MCDU에서 AOC › OOOI STATUS를 띄우고 **로그북 › OOOI 스캔**으로 찍습니다.
4. 확인 화면에서 사진과 값을 비교하고, 등록부호(HL)와 **T/O·L/D(PF/PM)**를 고른 뒤 저장합니다.

### 잘 찍는 요령
- 화면 정면에서, 형광등·창 반사를 피해서
- 오른쪽 끝(ORIG/DEST, OFF, ON 값)까지 화면 안에 들어오게
- ACARS PRINT 출력물을 찍어도 됩니다

## 테스트

`LogbookCore`는 Mac이나 Linux에서 바로 테스트할 수 있습니다.

```sh
cd ios-logbook/LogbookCore
swift test
```

테스트 데이터는 실제 MCDU 사진(OZ731 RKSI→VVTS)의 글자 위치를 재서 만든 것이고,
회사 Flight Log의 실제 줄(ICN-CTS 2:40, ICN-SGN 야간, TPE-ICN 해질녘)과 결과를 맞춰 봤습니다.
사진 자체는 개인정보가 있어 저장소에 넣지 않았습니다.

## 다음 단계 후보

- crew-skd 월간 스케줄(SKD 엑셀)에서 편명·구간·날짜를 미리 채우기 → 사진으로는 실제 시각만 입력
- 회사 Flight Log 출력물을 찍어 과거 기록 한꺼번에 가져오기
- 규정 양식 PDF 로그북 출력
- 구글 드라이브 자동 업로드 (Google 로그인 연동)
