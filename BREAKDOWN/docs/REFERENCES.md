# 구현 참고 자료

MIUUYY를 실행하거나 해당 코드를 포함하지 않고, 공개 구조 및 DOM 식별 접근만 참고했습니다.

- [MIUUYY 5.0.8 구조](https://github.com/miuuyy/codex-chatgpt-web/blob/v5.0.8/docs/architecture.md)
- [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)
- [Electron 탐색·팝업·IPC 보안](https://www.electronjs.org/docs/latest/tutorial/security)
- [Windows 사용자 세션 토큰](https://learn.microsoft.com/en-us/windows/win32/api/wtsapi32/nf-wtsapi32-wtsqueryusertoken)
- [Windows 서비스 세션 격리](https://learn.microsoft.com/en-us/windows/win32/services/interactive-services)

ChatGPT 웹 DOM은 공개된 호환성 계약이 아닙니다. 감지 지원 여부는 매 설치의 첫 테스트 대화로
확인하고, 알 수 없는 완료 상태는 턴으로 인정하지 않습니다.
