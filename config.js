// Google Cloud Console에서 만든 "웹 애플리케이션" OAuth 클라이언트 ID를 넣으세요.
// 비워 두면 화면의 "설정"에서 입력한 값(이 브라우저에만 저장)을 씁니다.
// 클라이언트 ID는 비밀값이 아니므로 공개 저장소에 올려도 됩니다. 만드는 법: docs/google-setup.md
window.SKD_CONFIG = {
  googleClientId: '390908508578-72d374cnfa1csnmdp2t4f7loeud1m3tu.apps.googleusercontent.com',
  // 로그북 iCloud 동기화 (Apple CloudKit). 만드는 법: docs/icloud-setup.md — 비워 두면 iCloud 칸이 "설정 필요"로 나옴
  cloudkit: {
    containerIdentifier: '',
    apiToken: '',
    environment: 'production'
  }
};
