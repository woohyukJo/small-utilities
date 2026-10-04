# BREAKDOWN Android 0.1.2-alpha3

데스크톱과 같은 대화 규칙을 Android에 연결하는 개발 프로젝트다. 현재 설치 파일의 빌드 성공을 실제 로그인·잠금·동기화 검증 완료로 간주하지 않는다.

S26/Android 16에서 개발용 빌드의 로그인·턴 감지·차단/해제·PC 연결을 확인했다. 장기 배터리와 다른 제조사까지 검증한 것은 아니므로 알파로 배포한다.

0.1.2부터 대화는 **일반 Firefox + BREAKDOWN 확장**에서 진행한다. Google 패스키를 지원하는 Firefox 로그인 상태를 그대로 사용한다. 앱에서 **Firefox 연결 → 연결 확인 → 하루 한 번 시작** 순서로 설정한다. 업데이트 직후에는 잠금이 꺼져 있으며 기존 비밀번호·선택 대화·PC 연결 설정을 유지한다. 확장의 영구 설치에는 Mozilla 서명이 필요하다. [Firefox 안내](../firefox-extension/README.md)를 참고한다.

## 매일 자동 시작

0.1.1부터 매일 오전 4시(KST)에 새 하루를 적용한다. 설정의 **새벽 4시 자동 시작 설정**에서 Android의 **알람 및 리마인더**를 허용하면 정확한 시간으로 예약한다. 미허용 시 지연 가능한 예약과 앱 열기·화면 전환·잠금 해제·접근성 서비스 재연결 시 날짜 확인을 함께 사용한다.

화면이 켜져 있고 일반 앱을 사용 중이면 Firefox의 선택한 대화를 하루 한 번 자동으로 연다. 화면이 꺼져 있거나 기기 잠금 중이면 화면을 깨우지 않고, 잠금 해제 후 표시한다. 시스템 설정·통화 화면은 가리지 않는다. 제한 화면의 **BREAKDOWN 열기** 버튼으로 앱의 비상 해제·설정 화면을 열 수 있다.

재부팅·앱 업데이트·시계 변경 뒤에는 다음 예약을 복구한다. 같은 날 반복 신호는 이미 완료한 턴을 초기화하지 않는다. 접근성 사용 제한 권한은 계속 필요하며, Android 설정에서 앱을 강제 중지한 경우 직접 다시 열어야 한다.

개발용 업데이트는 `adb install -r`로 기존 로그인·설정·비밀번호·PC 연결을 유지한다. `verification` 빌드는 별도 패키지·저장소에서 시스템 알람 전달을 검사하는 용도이며 사용자용 APK에는 검사 코드가 포함되지 않는다.

## 빌드

WSL/Linux 기준 Java 17, Android SDK 35, Gradle 8.10.2를 사용한다. SDK 위치는 `ANDROID_HOME` 또는 Git에서 제외되는 `local.properties`로 지정한다.

생성된 관찰 스크립트는 저장소에 포함돼 있어 Android 빌드만 할 때는 `android/`에서 Gradle 명령만 실행하면 된다.
관찰 스크립트를 수정할 때는 Node.js 24+ 환경의 데스크톱 `BREAKDOWN/` 폴더에서 다음 명령으로 갱신한다. 이 명령은 로그인 데이터나 개인 대화 설정을 읽지 않는다.

```sh
npm ci --ignore-scripts
npm run build
node scripts/build-mobile-probe.cjs
cd android
./gradlew testDebugUnitTest assembleDebug
```

관찰 스크립트는 데스크톱의 `page-probe.ts`와 `turn-tracker.ts`에서 생성한다. 개인 대화 내용은 반환하지 않으며, 과거 기록 제외·중복 방지·정지/재시도 규칙을 공유한다.

## 실제 기기 확인

배포 APK에는 `BREAKDOWN_SIGNING_FILE`(PKCS12 경로), `BREAKDOWN_SIGNING_PASSWORD` 환경변수가 필요하며 alias는 `breakdown`이다.
이 값 없이 release 빌드를 실행하면 실패하도록 구성했다. 현재 개발 환경의 키는 저장소 밖 `~/.local/share/breakdown/signing/`에 보관하며 버전 업데이트 시 같은 키를 사용한다.
개발용 앱 ID는 `local.breakdown.mobile.dev`, 배포 앱 ID는 `local.breakdown.mobile`로 구분되어 로그인 데이터가 서로 섞이지 않는다.
개발용에서 배포용으로 옮길 때는 개발용의 접근성 사용 제한부터 끄고 배포용을 새로 설정한다. 두 버전의 제한을 동시에 켜지 않는다.

대상 기기는 Galaxy S26이다. 일반 Firefox에서 Google 패스키 로그인과 실제 1턴 전달을 확인했다. Firefox 사용 중 통신이 유지되도록 앱은 실행 알림을 사용하는 서비스를 구동한다. 로그인 정보를 앱으로 가져오는 기능은 없다. 이전 WebView 구현은 새 대화 화면으로 사용하지 않는다.

일반 설치에서 접근성 기반 제한은 OS의 완전한 기기 잠금과 다르다. 앱 사용 제한 권한은 사용자가 설정에서 켜며, 시스템 설정·복구 경로는 보존한다.
수면 연동과 기기 간 동기화의 실제 구현·검증 현황은 상위 `docs/MOBILE_WORKLOG.md`를 참고한다.
