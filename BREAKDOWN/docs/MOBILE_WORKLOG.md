# Android 확장 작업 기록

## 목표와 작업 분담

데스크톱 0.1.9의 동작을 유지하면서 Android 앱을 추가한다. 코드 위치는 기존 BREAKDOWN 루트 아래 `android/`이며, 데스크톱 경로는 이번 작업에서 옮기지 않는다.
공통 규칙은 대화 내용 무관 세 턴, 명시적인 세션/잠금 해제 시점의 일일 전환, 조용한 완료, 비상 해제이다.

- Android 잠금 모델 조사: docs/ANDROID_LOCK_MODEL.md
- ChatGPT 구독 웹과 로그인 가능성 조사: docs/ANDROID_CHATGPT_WEB.md
- 갤럭시 링 수면 접근 조사: docs/ANDROID_SLEEP_DATA.md
- Kotlin 상태 엔진: android/app/src/main/java/local/breakdown/mobile/core/
- 앱 연결·검증·기기 간 동기화·배포: 메인 작업에서 통합

워커 모델은 사용자가 선택한 `chatgpt-web/gpt-5.6-sol`, reasoning High이다.

## 확인한 개발 환경

Ubuntu WSL 2: Java 17, Gradle 8.10.2 캐시, AGP 8.8.2, Kotlin 2.1.10을 사용한다.
AGP 8.8의 지원 상한은 API 35이므로 기존 SDK에 Android 35 플랫폼을 추가한다.
참고: https://developer.android.com/build/releases/agp-8-8-0-release-notes

테스트 기기는 사용자 소유 Galaxy S26이다. USB 연결 테스트가 가능하다고 확인했으나 아직 실제 연결·Android 버전·권한 설정·로그인 성공은 확인하지 않았다.
일반 설치 상태에서 시작한다. 기기 초기화, Device Owner 등록, 권한 자동 허용은 하지 않는다.

## 완료로 간주하지 않는 것

초기 앱 셸이 빌드되거나 단위 테스트가 통과해도 웹 로그인, 실제 턴 감지, 다른 앱 사용 제한, 양쪽 기기의 하루 완료 동기화가 구현·검증된 것은 아니다.
실제 계정·기기 확인 전에는 정식 배포나 잠금 활성화를 성공했다고 기록하지 않는다.
갤럭시 링 수면 판정 기준은 사용자가 나중에 정할 사항으로, 임의의 수면 시간 임계값을 확정하지 않는다.

## 초기 빌드 확인

WSL에서 기존 Gradle 캐시를 사용한 `--offline wrapper --gradle-version 8.10.2 --distribution-type bin :app:assembleDebug`가 성공했다(34 tasks).
현재 APK는 안내 화면만 있는 앱 셸이며 로그인이나 잠금은 아직 구현하지 않았다. 기기에 설치하거나 공개 배포하지 않았다.
Gradle wrapper를 소스 폴더에 수집했고 테스트 APK는 Git에서 제외되는 `artifacts/android/`에 보관한다.

## 기능 통합 및 실제 기기 연결

- 순수 Kotlin 상태 엔진, SharedPreferences 상태 저장, PBKDF2 비상 비밀번호, 대화 선택과 WebView 관찰 연결, 사용자 활성화 접근성 오버레이를 통합했다.
- 엔진·URL 단위 테스트 7개와 `assembleDebug`를 WSL에서 통과했다. 첫 테스트의 오전 4시 직전/직후 시각 표본 오류를 수정했다.
- 모바일 JavaScript 관찰기는 데스크톱의 probe/tracker에서 생성한다. 일일 scope와 대화 revision을 기준으로 오래된 결과를 제외한다.
- WebView·오버레이 워커는 구현 도중 ChatGPT 요청 제한으로 중단되어, 저장된 코드와 조사 결과를 메인 작업에서 이어받았다.
- Galaxy S26(SM-S942N), Android 16/API 36의 USB 디버깅 연결을 확인했다. Windows ADB가 WSL 서버로 연결되던 충돌은 별도 Windows 서버 포트 5038을 사용해 분리했다.
- 정식 앱과 데이터가 섞이지 않는 `local.breakdown.mobile.dev` 개발용 APK를 S26에 설치하고 실행했다. 접근성 권한과 일일 잠금은 자동으로 활성화하지 않았다.
- 실제 ChatGPT 로그인 성공 여부는 사용자의 확인을 기다리는 중이다. 잠금 실기기 검증, 기기 간 동기화, 수면 adapter 및 배포는 아직 완료하지 않았다.
