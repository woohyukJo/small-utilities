# 관리자 복구·제거

## 설치 중 service registration failed

0.1.0 설치 프로그램에는 Program Files 경로의 따옴표를 잘못 전달하는 오류가 있었습니다.
0.1.1 이상 설치 파일을 다시 실행하면 남아 있는 파일에 덮어 설치하고 서비스 등록을 재시도합니다.
기존 비밀번호·대화 프로필·MIUUYY 설정을 초기화할 필요는 없습니다.

0.1.1에서도 실패하면 오류 창의 Windows 종료 코드와
C:\ProgramData\BREAKDOWN\install-service.log를 확인합니다.
이 로그는 관리자 PowerShell에서 읽을 수 있으며 비밀번호나 대화 본문은 포함하지 않습니다.

## 앱 복구

먼저 앱의 비상 해제에서 앱 비밀번호를 10회 연속 입력합니다.
앱 자체가 응답하지 않거나 비밀번호를 잊었으면 **관리자 PowerShell**에서:

~~~powershell
Stop-Service -Name BreakdownGuard
~~~

서비스는 자신이 시작한 보조 프로세스와 UI만 종료합니다. 다른 프로그램이나 문서는 종료하지 않습니다.
다시 실행하려면:

~~~powershell
Start-Service -Name BreakdownGuard
~~~

같은 하루의 상태는 유지됩니다. 초기화가 필요하면 서비스를 먼저 중지하고
C:\ProgramData\BREAKDOWN의 gate.db, gate.db-wal, gate.db-shm을 **별도 폴더로 백업**한 뒤 제거합니다.
다음 시작 시 비밀번호/테스트 대화/활성화를 다시 설정합니다. 기존 install.json은 유지합니다.
일반 제거는 Windows 설정 → 앱 → BREAKDOWN에서 수행합니다. 제거 프로그램은 BREAKDOWN 서비스만
중지·삭제하며, 다른 앱 설정과 사용자 대화 프로필은 삭제하지 않습니다.

서비스를 시작할 수 없거나 관리자 계정이 다른 경우 install.json의 대상 사용자 SID와 설치 경로를 확인합니다.
기본 Administrator 계정 활성화나 MIUUYY 설정 변경은 필요하지 않습니다.
