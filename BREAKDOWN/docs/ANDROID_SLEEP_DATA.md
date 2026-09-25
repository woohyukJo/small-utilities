# Galaxy Ring 수면 데이터로 미래 하루 경계를 만드는 방법

기준일: 2026-09-25. 이 문서는 공식 Samsung 및 Android Health Connect 문서만으로 조사한 설계 메모다. 이번 작업에서는 Android 소스, Manifest, Health Connect 권한, 실제 건강 데이터를 변경하거나 수집하지 않는다.

## 결론

구현 가능한 경로는 다음과 같다.

`Galaxy Ring -> Samsung Health(휴대전화) -> Health Connect -> BREAKDOWN Android adapter`

Galaxy Ring은 Samsung Health의 수면 측정 소스로 공식 지원되고, Samsung Health는 수면 데이터를 Health Connect의 `SleepSessionRecord`로 동기화한다. 따라서 BREAKDOWN Android 앱은 Samsung 전용 SDK 없이 Health Connect를 통해 수면 세션을 읽는 구현을 만들 수 있다.

다만 다음 두 가지는 계약으로 보면 안 된다.

- **도착 시점**: 웨어러블 데이터의 휴대전화 전송, Samsung Health 처리, Health Connect 동기화에는 지연이 생길 수 있으며 공식 SLA가 없다.
- **Galaxy Ring 귀속**: Health Connect의 `dataOrigin`은 데이터를 기록한 앱 패키지를 가리킨다. `Device`에는 ring 타입이 존재하지만 제조사·모델 등은 선택 정보이고, Samsung Health가 내보내는 `SleepSessionRecord`가 항상 Galaxy Ring으로 식별 가능한 메타데이터를 보존한다고 Samsung은 보장하지 않는다. Ring과 Watch를 함께 착용하면 Samsung Health 자체가 두 기기의 수면 데이터를 통합할 수 있다.

따라서 **수면 세션의 존재와 시각은 사용할 수 있지만, "이 세션은 반드시 Galaxy Ring 단독 측정"이라는 조건을 핵심 로직에 두면 안 된다.** Ring 귀속은 진단 정보로만 취급하고 실기기에서 확인한다.

## 확정된 요구사항

현재 프로젝트에서 이미 정한 동작과 이번 조사 범위는 다음과 같다.

- 현재 하루 기준은 임시로 **KST 04:00**이다.
- 하루가 바뀌어도 사용 중 갑자기 잠그지 않고, 다음 Windows 로그인/화면 잠금 해제 같은 기존 적용 지점에서 새 하루를 반영한다.
- 수면 연동은 미래 작업이며, 현재 코드에는 추가하지 않는다.
- 이번 단계에서는 공식 Samsung 및 Android Health Connect 문서만 사용한다.
- 실제 개인 수면 데이터는 수집하지 않는다.
- Android 앱 소스, Health Connect 권한 선언/요청은 이번 작업에서 변경하지 않는다.
- 사용자는 아직 **낮잠과 주 수면(main sleep)을 어떻게 구분할지 결정하지 않았다.** 이 문서에서는 임의의 수면 길이, 취침 시각, 기상 시각 임계값을 확정하지 않는다.

## 공식 문서로 확인한 데이터 경로

### 1. Galaxy Ring -> Samsung Health

Samsung은 Galaxy Ring이 수면 패턴을 측정하고, 다음 날 Galaxy Wearable/Samsung Health에서 기록된 수면 시간을 확인할 수 있다고 안내한다. Samsung Health Data SDK의 `SleepType` 문서도 수면 데이터가 Galaxy Watch, Galaxy Fit, Galaxy Ring 같은 웨어러블에서 측정될 수 있다고 명시한다.

즉, **Ring이 수면 측정 소스가 되는 것 자체는 공식 지원**이다.

### 2. Samsung Health -> Health Connect

Samsung Health는 6.22.5(2022-10)부터 Health Connect 동기화를 지원한다. 공식 Samsung 문서의 지원 데이터 표에서 Samsung Health의 `Sleep session / Sleep stage`는 Health Connect의 `SleepSessionRecord`에 대응한다.

Samsung Health에 새 데이터나 수정 데이터가 생기면 Health Connect에 기록한다. 사용자는 Samsung Health에서 Health Connect 연결과 공유 권한을 켜야 한다.

### 3. Health Connect -> BREAKDOWN

Android Health Connect는 `SleepSessionRecord`를 수면 세션 타입으로 제공한다. 세션에는 시작/종료 시각과 수면 단계가 포함될 수 있다. 읽기에는 `android.permission.health.READ_SLEEP`가 필요하다.

BREAKDOWN의 경계 판정에는 수면 단계나 산소포화도 등이 필요하지 않으므로, 미래 구현의 최소 범위는 **`SleepSessionRecord` 읽기만**으로 잡는 것이 적절하다. `WRITE_SLEEP`는 이 기능에 필요하지 않다.

## 사용자 설정과 권한

### Samsung Health 쪽

Samsung Health와 Health Connect를 연결하고, Samsung Health가 수면 데이터를 Health Connect에 쓸 수 있도록 사용자가 권한을 허용해야 한다. Samsung 안내 경로는 대략 다음과 같다.

`Samsung Health -> Settings -> Health Connect -> App permissions -> Samsung Health`

Android 설정에서 권한을 바꾼 경우 Samsung은 Samsung Health 앱을 한 번 실행하도록 안내한다.

### BREAKDOWN Android 앱 쪽

미래 구현에서 필요한 최소 권한은 다음이다.

- 필수: `android.permission.health.READ_SLEEP`
- 선택: `android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND`
- 일반적인 하루 경계 기능에는 불필요: `android.permission.health.READ_HEALTH_DATA_HISTORY`

`READ_SLEEP`는 Manifest 선언만으로 끝나지 않고 Health Connect의 사용자 승인도 필요하다. 사용자는 언제든 권한을 취소할 수 있으므로 읽기 전에 현재 승인 상태를 확인해야 한다.

백그라운드 읽기는 별도 권한이며 기기/Health Connect 버전에서 기능 지원 여부도 `FEATURE_READ_HEALTH_DATA_IN_BACKGROUND`로 확인해야 한다. 지원되지 않거나 사용자가 거부해도 앱 전체가 실패해서는 안 된다.

과거 데이터는 기본적으로 앱에 읽기 권한이 처음 부여된 시점보다 최대 30일 전까지 읽을 수 있다. 그보다 오래된 데이터가 필요할 때만 `READ_HEALTH_DATA_HISTORY`가 필요하다. BREAKDOWN은 최신 하루 경계만 판정하면 되므로 현재 설계에서는 이 권한을 요구할 이유가 없다.

## 플랫폼 가용성

- Health Connect 사용에는 Android 9(API 28) 이상과 Google Play 서비스가 필요하다.
- Android 14 이상에서는 Health Connect가 시스템 구성요소다.
- Android 13 이하에서는 Google Play의 Health Connect 앱이 필요하다.
- `SleepSessionRecord` 자체에는 별도의 기능 가용성 플래그가 없다.
- 백그라운드 읽기 같은 부가 기능은 별도 기능 플래그를 확인해야 한다.

## 동기화 지연과 실패를 정상 상태로 취급해야 하는 이유

Samsung의 수면 예제는 웨어러블의 수면 데이터가 기상 후 휴대전화로 전송되고 처리된 뒤 Health Connect에 동기화되며, 전송과 동기화가 프로세서 가용성 등에 따라 지연될 수 있다고 설명한다. Galaxy Ring 지원 문서도 착용 직후 데이터가 즉시 Samsung Health에 보이지 않을 수 있다고 안내한다.

따라서 다음 상태는 오류가 아니라 정상적인 입력 상태다.

- 아직 Samsung Health에 Ring 수면 기록이 도착하지 않음
- Samsung Health에는 보이지만 Health Connect 동기화가 아직 안 됨
- BREAKDOWN에 `READ_SLEEP`가 없음
- 백그라운드 읽기 권한/기능이 없어 앱이 활성화될 때까지 읽을 수 없음
- Samsung Health 또는 BREAKDOWN 쪽 Health Connect 권한이 사용자가 취소함
- 수면 기록이 나중에 수정되거나 재동기화됨

경계 로직은 이 중 어느 경우에도 반복 초기화, 재잠금, 반복 해제를 만들면 안 된다.

## Ring 귀속은 보장되지 않음

Health Connect 메타데이터에서 `dataOrigin`은 **데이터를 Health Connect에 기록한 앱의 패키지명**이다. Samsung Health가 동기화한 레코드라면 이를 통해 Samsung Health 유래인지는 판별할 수 있지만, 원래 측정 장치까지 뜻하지는 않는다.

Health Connect `Device`에는 `TYPE_RING`이 있고, 자동/능동 측정 데이터에는 device type을 기록하는 메타데이터 모델이 있다. 그러나 제조사, 모델, 표시 이름 같은 필드는 선택 사항이며, Samsung 공식 Health Connect 문서는 Samsung Health가 내보내는 모든 수면 레코드에 원 측정 장치 정보를 어떤 방식으로 보존하는지 계약하지 않는다.

또한 Samsung Health Data SDK의 공식 수면 예제는 사용자가 Galaxy Watch와 Galaxy Ring을 동시에 착용하면 Samsung Health가 두 기기의 데이터를 결합해 하나의 통합 수면 세션을 만들 수 있다고 설명한다. 이 경우 “Ring 단독 세션”이라는 의미 자체가 성립하지 않을 수 있다.

따라서 미래 구현은 다음 원칙을 사용한다.

- 경계 판정의 신뢰 근거: Samsung Health가 Health Connect에 제공한 유효한 수면 세션
- 선택적 진단 정보: `metadata.device.type`, 제조사/모델, recording method
- 금지할 가정: `TYPE_RING` 또는 특정 Galaxy Ring 모델명이 항상 존재해야만 수면 세션을 인정

## 제안: `SleepBoundaryAdapter`

아래는 아직 구현하지 않은 **설계 제안**이다.

```text
DayBoundaryProvider
  ├─ ManualKst04Provider        # 현재 기본값, 항상 사용 가능
  └─ HealthConnectSleepAdapter  # 선택 기능
         └─ MainSleepSelector   # 정책 미정
```

`HealthConnectSleepAdapter`는 최근 `SleepSessionRecord`를 일시적으로 읽고, 경계 판정에 필요한 최소 결과만 반환한다. 원시 수면 단계, 심박, 산소포화도, 수면 점수 등을 BREAKDOWN 저장소에 복제하지 않는다.

예시 반환 상태:

```text
Unavailable
PermissionMissing
NoDataYet
ReadError
MainSleepCandidate(endInstant, sourceMetadataSummary)
```

`sourceMetadataSummary`는 진단 화면/로그가 필요할 때만 최소 정보로 사용하고, 경계의 정확성을 Galaxy Ring 귀속에 의존시키지 않는다.

## 제안: main-sleep day token

주 수면 세션 하나가 선택되었다고 가정하면, 가장 단순하고 기존 KST 04:00 fallback과 합치기 쉬운 토큰은 다음이다.

```text
day:<KST에서 본 선택된 main sleep 종료일>
```

예를 들어 선택된 주 수면이 2026-09-25 07:10 KST에 끝났다면 `day:2026-09-25`다.

이 토큰은 `SleepSessionRecord.id`나 정확한 종료 시각을 토큰에 넣지 않는다. Samsung Health가 같은 수면을 나중에 수정하거나 Health Connect 레코드가 다시 동기화되어도 **기상일이 같으면 같은 하루**로 유지하기 위해서다.

현재 fallback도 같은 논리적 형식으로 만든다.

```text
manual token = day:<LocalDate(now_KST - 4h)>
```

그러면 수면 데이터가 늦게 도착한 일반적인 경우에도 중복 경계가 생기지 않는다.

예:

1. 04:00 이후에도 Health Connect 수면 데이터가 없음.
2. fallback이 `day:2026-09-25`를 만들고, 기존 규칙대로 다음 로그인/잠금 해제 시 한 번만 새 하루를 적용.
3. 08:30에 수면 세션이 늦게 도착하고 종료일이 2026-09-25로 판정됨.
4. sleep token도 `day:2026-09-25`이므로 추가 reset/re-lock/unlock 없음.

## 제안: 단조(monotonic) 적용 규칙

경계 공급자가 무엇이든 Gate 쪽에서는 이미 적용한 토큰보다 과거 토큰으로 되돌아가지 않게 한다.

```text
candidate == committed -> no-op
candidate <  committed -> ignore as late/old data
candidate >  committed -> mark next day pending
```

그리고 기존 확정 동작을 유지해 실제 초기화는 다음 로그인/잠금 해제 같은 허용된 세션 이벤트에서 한 번만 수행한다.

이 규칙의 목적은 다음 문제를 막는 것이다.

- fallback으로 이미 새 하루를 시작한 뒤 수면 데이터가 늦게 도착해 두 번째 reset이 생김
- Health Connect 기록 수정으로 레코드 ID가 바뀌어 같은 날을 새 날로 오인함
- 권한 on/off 또는 일시적 읽기 실패 때문에 수면/수동 공급자 사이를 오가며 token이 흔들림
- 이미 해제한 하루가 뒤늦은 데이터 때문에 다시 잠김

## 아직 결정하지 않은 main-sleep 정책

`MainSleepSelector`는 별도 정책으로 남겨야 한다. 현재는 다음 중 무엇을 사용할지 정하지 않는다.

- 여러 `SleepSessionRecord` 중 가장 긴 세션
- Samsung Health가 만든 통합 수면 세션을 우선
- 사용자의 수면 목표/평소 취침대와 겹치는 세션
- 사용자가 직접 주 수면으로 지정
- 낮잠을 별도 취급하거나 같은 날에 합산

이 선택은 제품 의미를 바꾸므로 “몇 시간 이상”, “몇 시 이후”, “가장 긴 세션” 같은 임계값을 이번 문서에서 기본값으로 확정하지 않는다.

**정책이 정해질 때까지 실제 경계는 기존 KST 04:00을 사용하고, Health Connect 연동은 후보 수면 세션을 관찰하는 수준으로 두는 것이 안전하다.**

## 백그라운드 동작 제안

백그라운드 읽기는 정확도를 개선하는 선택 기능이지 correctness의 전제가 아니어야 한다.

- `READ_HEALTH_DATA_IN_BACKGROUND`가 승인되고 기능이 사용 가능하면 WorkManager 등으로 주기적 확인 가능.
- 권한이 없으면 앱이 전경으로 돌아왔을 때, 또는 사용자가 경계 관련 화면을 열었을 때 읽는다.
- 어느 경우에도 데이터가 없으면 KST 04:00 fallback을 사용한다.
- 늦게 도착한 수면 데이터는 같은 `day:YYYY-MM-DD`이면 상태만 보강하고 재초기화하지 않는다.

정확한 poll 주기나 재시도 횟수는 아직 요구사항으로 정하지 않는다.

## 실기기에서 반드시 확인할 항목

공식 문서만으로 확정할 수 없는 부분은 Galaxy Ring + 실제 Samsung Health + Health Connect 조합에서 확인해야 한다.

1. **Ring 단독 착용** 후 Samsung Health 수면이 Health Connect `SleepSessionRecord`로 실제 생성되는지.
2. 생성된 레코드의 `metadata.dataOrigin.packageName`, recording method, `metadata.device.type`, manufacturer, model 값.
3. **Ring + Galaxy Watch 동시 착용** 시 Health Connect에서 하나의 통합 세션인지, 여러 세션인지, device metadata가 무엇인지.
4. 기상 후 Ring -> Samsung Health -> Health Connect까지 실제 지연 분포. Samsung Health 앱 열기/당겨서 동기화가 지연에 어떤 영향을 주는지.
5. 같은 수면이 나중에 수정될 때 Health Connect에서 동일 ID 업데이트인지, 새 레코드/삭제+삽입인지.
6. Samsung Health에서 수면 공유 권한을 끄고 켰을 때 기존/신규 레코드가 어떻게 보이는지.
7. BREAKDOWN의 `READ_SLEEP`만 승인한 상태와, 선택적으로 background read까지 승인한 상태의 동작 차이.
8. 사용자가 Samsung Health에서 수면을 수동 입력했을 때 metadata가 자동 측정 수면과 구분 가능한지.
9. 04:00 전 기상, 04:00 후 기상, 데이터 지연, 권한 취소/복구 각각에서 day token이 한 번만 전진하는지.

실기기 검증 전에는 Galaxy Ring 전용 필터를 구현 요구사항으로 승격하지 않는다.

## 구현 가능 범위

향후 Android 지원은 다음 범위로 구현 가능하다.

- Health Connect 가용성 확인
- `READ_SLEEP` 사용자 승인
- `SleepSessionRecord` 조회
- 미정의 `MainSleepSelector`를 분리한 adapter 구조
- 현재 KST 04:00 기본값 유지
- 선택된 main sleep의 KST 종료일을 이용한 `day:YYYY-MM-DD` 후보 토큰
- 권한 없음/데이터 지연/읽기 실패 시 manual fallback
- 토큰 단조 적용으로 늦은 데이터와 재동기화에 의한 반복 reset/re-lock 방지
- 원시 건강 데이터의 별도 저장 없이 경계 판정만 수행

남은 제품 결정은 **어떤 수면을 main sleep으로 볼 것인지**다. 이 정책만 결정되면 Health Connect 측 기술 경로는 구현 가능한 수준으로 확인됐다.

## 공식 출처

Samsung:

- [Track your sleep with the Galaxy Ring](https://www.samsung.com/us/support/answer/ANS10003282/)
- [Samsung Health Data SDK: SleepType](https://developer.samsung.com/health/data/api-reference/-shd/com.samsung.android.sdk.health.data.request/-data-type/-sleep-type/index.html)
- [Accessing Samsung Health Data through Health Connect](https://developer.samsung.com/health/blog/en/accessing-samsung-health-data-through-health-connect)
- [Managing Sleep Data with Samsung Health and Health Connect](https://developer.samsung.com/health/blog/en/managing-sleep-data-with-samsung-health-and-health-connect)
- [Health Connect FAQ to Access Samsung Health Data](https://developer.samsung.com/health/health-connect-faq.html)
- [Access rich sleep data from Samsung Health measured by Galaxy wearables](https://developer.samsung.com/codelab/health/sleep-data.html)
- [Samsung Health Data SDK: Device manager](https://developer.samsung.com/health/data/guide/features/device-manager.html)

Android:

- [Track sleep sessions](https://developer.android.com/health-and-fitness/health-connect/features/sleep-sessions)
- [Read raw data](https://developer.android.com/health-and-fitness/health-connect/read-data)
- [Permissions and data access](https://developer.android.com/health-and-fitness/health-connect/ui/permissions)
- [Check Health Connect availability](https://developer.android.com/health-and-fitness/health-connect/availability)
- [Check for feature availability](https://developer.android.com/health-and-fitness/health-connect/features/availability)
- [Health Connect data type format](https://developer.android.com/health-and-fitness/health-connect/data-format)
- [Metadata requirements](https://developer.android.com/health-and-fitness/health-connect/metadata)
