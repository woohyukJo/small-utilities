# 저장소와 개발 환경

대상 저장소는 `woohyukJo/small-utilities`이며 BREAKDOWN은 `BREAKDOWN/` 하위 폴더에 넣는다.
소스와 문서는 Git으로 관리하고 설치 파일은 필요한 버전만 별도 GitHub Releases로 게시한다.
`node_modules`, SDK, 빌드 산출물, 테스트 임시 파일, 사용자 DB와 브라우저 프로필은 소스 이력에 포함하지 않는다.

## Windows

기존 데스크톱 개발 폴더는 `C:\Users\woohyuk\Documents\Codex\할일BREAKDOWN`이다.
이 폴더 자체는 현재 Git 작업 사본이 아니다. 저장소로 옮겼다고 해서 원래 폴더의 변경이 자동 반영되지는 않는다.
이후 Windows에서 Git으로 직접 개발하려면 저장소를 Windows에도 clone하고 개발 도구를 준비한다.
원래 폴더에서 계속 수정하는 경우 변경한 소스를 저장소의 BREAKDOWN 폴더에 명시적으로 반영한다.

Windows 서비스와 Electron 설치 패키지의 빌드·시스템 통합 검증은 Windows에서 수행한다.
프로젝트에 준비된 `.tools/dotnet/dotnet.exe`는 .NET 10 SDK이며, 시스템 기본 dotnet과 다를 수 있다.
기존 scripts/build.ps1은 이 SDK가 있으면 우선 사용하고 없으면 PATH의 dotnet을 사용한다.
실제 명령과 필수 도구는 프로젝트 README를 따른다.

## WSL

Ubuntu WSL 2에 Git, GitHub CLI, Node.js/npm, Java와 Android SDK가 확인되어 있다.
저장소 작업 사본은 `/home/mymemeisjo/projects/small-utilities`에 clone되어 있다.
Windows에서 SSH 없이 다음처럼 명령을 실행할 수 있다.

```powershell
wsl.exe -d Ubuntu --exec git -C /home/mymemeisjo/projects/small-utilities status
```

Linux에서 빌드할 소스와 의존성은 WSL 파일 시스템 안에 둔다.
Windows의 node_modules나 SDK를 Linux용 의존성으로 재사용하지 않는다.
Android 프로젝트는 `BREAKDOWN/android`에 있으며 Java 17, Gradle 8.10.2, AGP 8.8.2와 Android SDK 35로 빌드한다. 실제 기기 검증 범위는 MOBILE_WORKLOG.md에 기록한다.

## 작업 사본 간 동기화

Windows와 WSL 작업 사본은 Git commit/push/pull로 변경을 주고받는다.
작업 전 pull하고, 한쪽의 변경을 반영하기 전에 다른 쪽에서 같은 파일을 동시에 수정하지 않는다.
각 프로젝트의 빌드 산출물과 사용자 설정은 작업 사본 간 자동 동기화 대상이 아니다.

0.1.9부터 개인 대화 ID 파일 없이 소스를 빌드한다.
사용할 ChatGPT 대화는 설치 후 앱에서 지정한다. 이전 버전의 private JSON을 복사하는 방식은 새 빌드 절차로 사용하지 않는다.
