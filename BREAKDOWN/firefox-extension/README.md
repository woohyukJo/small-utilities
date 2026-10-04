# Firefox 연결 시험

Android에서 Google 패스키로 로그인한 Firefox 대화를 기존 BREAKDOWN 턴 관찰기로 연결하는 시제품이다. **실제 잠금 앱에는 아직 연결하지 않았다.** APK의 `verification` 변형은 별도 패키지 `local.breakdown.mobile.verification`에서만 시험하고 기기 제한을 켜지 않는다.

## 구성과 데이터

- content script는 `https://chatgpt.com/`에서만 실행한다. 대화 ID, 제출/완료/중단 이벤트와 불투명 메시지 ID를 전달한다. 메시지 본문·쿠키·패스키·Google 인증 정보를 전송하지 않는다.
- background script가 같은 휴대폰의 `127.0.0.1:18432`에 연결한다. 서버는 IPv4 loopback에만 바인딩하고 앱별 무작위 연결 키로 요청을 확인한다. LAN과 외부 서버는 사용하지 않는다.
- 연결 키는 앱의 개인 저장소와 Firefox 확장의 `storage.local`에 보관한다. 페어링 URL의 fragment는 읽은 즉시 주소에서 제거한다. Git과 배포 파일에 개인 키를 포함하지 않는다.
- Firefox의 데이터 전달 선언은 앱 연결 키(`authenticationInfo`), 선택한 대화 주소/ID(`browsingActivity`), 제출·완료 이벤트(`websiteActivity`)에 해당한다. 위 정보는 같은 기기의 앱으로만 전달한다.
- 기존 기록이 늦게 추가되는 것을 새 대화로 오인하지 않도록 이 시제품은 실제 Enter/전송 버튼 신호를 요구한다. 본문이나 할 일 품질을 평가하지 않는다. IME/음성 등 다른 입력 경로는 별도 실기기 검증이 필요하다.

## 개발 및 설치

기존 TypeScript 빌드 후 `node scripts/build-firefox-extension.cjs`로 `detector.js`를 생성한다. 파일은 desktop의 `page-probe.ts`, `turn-tracker.ts`에서 만들며 직접 편집하지 않는다.

개발 도구는 프로젝트 내부에 `pnpm --dir .tools/browser-dev add -D --save-exact web-ext@10.7.0`로 설치한다. `web-ext lint -s firefox-extension` 및 `web-ext build -s firefox-extension`으로 검사/패키징한다. 도구 실행 시 작업 폴더에 맞는 절대 경로를 전달할 수 있다.

휴대폰 Firefox의 ‘USB를 통한 원격 디버깅’을 켜고 다음 옵션으로 임시 설치한다. 이 프로젝트의 S26 Windows adb 서버는 별도 포트 5038을 사용한다.

```text
web-ext run -t firefox-android -s <extension-directory> --adb-bin <adb.exe> --adb-port 5038 --adb-device <serial> --firefox-apk org.mozilla.firefox --no-reload
```

임시 설치는 Firefox 재시작 뒤 유지되는 배포가 아니다. 일반 Firefox에 상시 설치하려면 Mozilla 서명 절차가 필요하다. 공개 검색에 노출하지 않는 unlisted 배포도 가능하지만, Mozilla 계정/서명과 실제 설치 검증은 아직 진행하지 않았다.

## 확인 범위 (2026-10-05)

- 사용자가 S26 일반 Firefox에서 Google 패스키 로그인 성공을 확인했다.
- 임시 확장 설치, loopback 연결, 잘못된 연결 키 거절을 확인했다.
- 숨겨진 textarea가 실제 입력창보다 먼저 선택되는 문제를 실기기에서 확인하고 공통 관찰기를 수정했다.
- 기존 대화가 뒤늦게 표시될 때의 오집계를 합성 Chromium 검사로 재현/방지했고, 실제 열린 대화 5쌍에서 초기 시험 카운터 0과 대기 0을 확인했다.
- Firefox 사용 중 시험 앱 통신이 멈추는 현상을 발견해 알림을 표시하는 foreground service로 시험 프로세스를 유지하도록 보완했다. 장기 절전 검증은 별도다.
- 수정본의 새 사용자 입력 → 완료 → 1/3 및 최종 3/3은 사용자 실대화 확인 중이다. 이전 시제품이 기록한 3/3은 과거 기록 혼입 가능성이 있어 성공 증거로 사용하지 않는다.

남은 작업은 실대화 확인, 잠금 앱의 Firefox 모드/허용 범위/연결 복구 통합, 영구 확장 서명·설치다. 기존 `local.breakdown.mobile.dev`는 사용자의 요청으로 강제 종료 상태를 유지한다.
