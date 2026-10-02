## ADDED Requirements

### Requirement: Conductor не дублює розвідку спеціаліста

У `/opsx:propose` parent-conductor MUST NOT досліджувати репозиторій (grep/cat/sed по `bin/`, `src/`, специфікаціях чи чужих changes) ні до, ні після спавну `spec-architect`: розвідка належить спеціалісту. Conductor SHALL читати лише decision brief (за шляхом), `status` кіта і `handoff --restore`, а на re-propose, коли існує `review.md` з `Verdict: REQUEST CHANGES` (Tier 1 чи Tier 2), ще й цей `review.md`; SHALL заспавнити `spec-architect` щонайбільше за 5 викликів інструментів, включно з цим читанням, і SHALL передати в spawn-prompt шлях до brief (або дослівний опис користувача, якщо brief-файлу немає) і назву change, а на re-propose ще й шлях до `review.md`, його вердикт і список Required Before Apply, а не вставлений зміст чи дайджест власної розвідки. Після звіту conductor SHALL зробити щонайбільше 3 виклики (один shell-виклик: `openspec status`, перелік заявлених шляхів артефактів і `gate-check --review <name>`; потім persist сесії) і за зеленого гейта MUST NOT перечитувати артефакти; червоний гейт додає лише один re-spawn і один повторний `gate-check --review`. Попередження `artifact budget` conductor MUST передати користувачу в підсумку. Ця вимога доповнює «Conductor must delegate specialist work» і «Повторний propose після REQUEST CHANGES бере повний punch list» і не змінює їх: на re-propose conductor і далі MUST перевірити за звітом, що кожен пункт закрито, і MUST NOT сам редагувати proposal/design/specs/tasks.

#### Scenario: Зелений гейт без перечитування

- **GIVEN** `/opsx:propose <name>` і decision brief у git-tracked файлі
- **WHEN** conductor виконує сесію
- **THEN** він читає brief за шляхом, `status` і `handoff --restore` та спавнить `spec-architect` щонайбільше за 5 викликів, передаючи шлях до brief і назву change
- **AND** після звіту робить щонайбільше 3 виклики і за `gate-check --review` exit 0 не читає артефакти

#### Scenario: Червоний гейт дає один re-spawn

- **GIVEN** `gate-check --review <name>` після звіту architect-а завершився з exit ≠ 0
- **WHEN** conductor реагує
- **THEN** він один раз переспавнює `spec-architect` з повним списком помилок і запускає `gate-check --review` повторно
- **AND** не досліджує репозиторій сам

#### Scenario: Попередження бюджету доходить до користувача

- **GIVEN** `gate-check --review <name>` завершився з exit 0 і вивів рядок `artifact budget`
- **WHEN** conductor пише підсумок
- **THEN** підсумок дослівно передає це попередження і радить розбити change на зрізи в бюджет
- **AND** next command лишається `/opsx:review <name>`

#### Scenario: Re-propose читає review.md у межах бюджету

- **GIVEN** `/opsx:propose <name>` і `review.md` з `Verdict: REQUEST CHANGES` та списком Required Before Apply
- **WHEN** conductor виконує сесію
- **THEN** він читає `review.md` у межах тих самих 5 викликів до спавну і передає `spec-architect` шлях до `review.md`, вердикт і список Required Before Apply разом зі шляхом до brief і назвою change
- **AND** після звіту перевіряє, що кожен пункт закрито, не редагує proposal/design/specs/tasks сам і за зеленого гейта не перечитує артефакти

#### Scenario: Brief-файлу немає

- **GIVEN** `/opsx:propose` отримав лише опис від користувача
- **WHEN** conductor спавнить `spec-architect`
- **THEN** він передає опис дослівно, а розвідку виконує `spec-architect`

### Requirement: Спеціалісти читають вузько

`spec-architect` і `spec-reviewer` SHALL читати main specs за заголовками вимог (`grep -n '^### Requirement:'`) і лише ті вимоги, яких торкається delta або з якими вона може конфліктувати, а не цілий великий spec; інші файли репозиторію понад 20 KB SHALL читатись діапазонами (якір ± 40 рядків); файли самого change (`openspec/changes/<name>/`: усі артефакти і наявний `review.md`) SHALL читатись повністю, один раз, бо цього вимагають вичерпний скан Tier 2 і повторний propose; спеціаліст MUST NOT перечитувати файл, уже прочитаний у сесії, і SHALL об'єднувати незалежні читання в один виклик. `spec-architect` MUST NOT приховувати повідомлення `artifact budget`: у режимі `warn` він SHALL перелічити його в `**Risks:**` із пропозицією нарізки на зрізи, у режимі `strict` SHALL повернути `**Status:** blocked` з тією ж пропозицією в `**Risks:**` (єдиний виняток із кроку 6 інструкції architect: виправляти кожну помилку gate-check).

#### Scenario: Architect читає main spec за заголовками

- **GIVEN** delta торкається однієї вимоги великого main spec
- **WHEN** `spec-architect` готує артефакти
- **THEN** він отримує перелік заголовків вимог через grep і читає лише ту вимогу та суміжні, а не весь файл
- **AND** не читає вдруге файл, який уже читав у цій сесії

#### Scenario: Артефакти change не обрізаються діапазонами

- **GIVEN** `tasks.md` change понад 20 KB і наявний `review.md`
- **WHEN** `spec-reviewer` виконує скан перед вердиктом
- **THEN** він читає `tasks.md` і `review.md` повністю, по одному разу, а не діапазонами навколо якоря
- **AND** main spec понад 20 KB читає за заголовками вимог

#### Scenario: Бюджет у strict блокує architect

- **GIVEN** `pipeline.artifact_budget: strict` і `gate-check --review` повертає помилку `artifact budget`
- **WHEN** `spec-architect` складає звіт
- **THEN** `**Status:**` є `blocked`, а `**Risks:**` містить пропозицію розбити change на зрізи
