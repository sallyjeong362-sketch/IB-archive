# 수업자료 아카이브 (IB-archive)

선생님들이 함께 수업 자료를 등록하고, 실제 진행한 활동을 기록하고, 서로 댓글로 의견을 나눌 수 있는 공유 아카이브입니다.

## 주요 기능

- 📖 수업에 쓰인 텍스트/내용 기록
- ✅ 실제 진행한 활동 설명 기록
- 📎 파일 업로드 (문서, PPT, PDF 등)
- 🖼️ 이미지 업로드 (갤러리로 표시)
- 🔗 외부 링크 연결 (유튜브 링크는 자동으로 영상이 임베드됩니다)
- 💬 게시물마다 댓글로 다른 선생님과 의견 공유
- 🔍 제목/내용/과목·태그 검색 및 필터
- 실시간 동기화: 한 선생님이 자료를 등록하거나 댓글을 달면 다른 선생님 화면에도 바로 반영됩니다.

빌드 과정이 필요 없는 순수 HTML/CSS/JS 정적 사이트이며, 데이터 저장과 실시간 공유를 위해 [Firebase](https://firebase.google.com/) 무료 요금제(Spark)를 사용합니다.

## 처음 설정하기 (한 번만 하면 됩니다)

1. [Firebase 콘솔](https://console.firebase.google.com/)에서 새 프로젝트를 만듭니다.
2. 왼쪽 메뉴 **Firestore Database** → "데이터베이스 만들기" (프로덕션 모드로 시작해도 됩니다. 리전은 아무 곳이나 선택 가능).
3. 왼쪽 메뉴 **Storage** → "시작하기"로 활성화합니다. (파일/이미지 업로드용)
4. 왼쪽 메뉴 **Authentication** → "시작하기" → Sign-in method 탭에서 **익명(Anonymous)** 제공업체를 사용 설정합니다. (이름을 입력하는 것만으로 이용할 수 있도록, 로그인 화면 없이 백그라운드에서 익명 인증을 사용합니다.)
5. 프로젝트 설정(톱니바퀴 아이콘) → 일반 탭 → "내 앱" → 웹 앱 추가(`</>`) → 앱 닉네임 입력 후 등록. 이때 나오는 `firebaseConfig` 객체(`apiKey`, `authDomain` 등)를 복사해둡니다.
6. 이 저장소의 [`firestore.rules`](./firestore.rules) 내용을 Firebase 콘솔 → Firestore Database → 규칙 탭에 붙여넣고 **게시**합니다.
7. 이 저장소의 [`storage.rules`](./storage.rules) 내용을 Firebase 콘솔 → Storage → 규칙 탭에 붙여넣고 **게시**합니다.
8. 앱(`index.html`)을 열면 나오는 설정 화면에 5번에서 복사한 `firebaseConfig`를 그대로 붙여넣고 "연결하고 시작하기"를 누릅니다. 이후 이름(별명)을 한 번 입력하면 바로 사용할 수 있습니다. 설정값은 각 선생님의 브라우저(localStorage)에 저장되므로, 같은 Firebase 프로젝트 설정을 다른 선생님들께도 공유해 각자 한 번씩 붙여넣도록 안내해주세요.

> 설정을 바꾸고 싶다면 앱 오른쪽 위 "연결 설정" 버튼을 누르면 다시 입력할 수 있습니다.

## 로컬에서 미리보기

빌드 도구가 필요 없어 정적 파일 서버만 있으면 됩니다.

```bash
npx serve .
# 또는
python3 -m http.server 8080
```

## GitHub Pages로 배포하기

`main` 브랜치에 푸시하면 `.github/workflows/deploy-pages.yml` 워크플로가 자동으로 GitHub Pages에 배포합니다. 저장소 설정(Settings → Pages)에서 Source를 **GitHub Actions**로 지정해주세요.

## 데이터 구조 (Firestore)

- `posts/{postId}`: `title`, `tags[]`, `lessonText`, `actionDescription`, `files[]`, `images[]`, `links[]`, `authorName`, `authorUid`, `createdAt`
- `posts/{postId}/comments/{commentId}`: `text`, `authorName`, `authorUid`, `createdAt`

파일/이미지는 Firebase Storage의 `uploads/{postId}/...` 경로에 저장되고, 다운로드 URL만 Firestore 문서에 저장됩니다.

## 권한 정책

- 모든 자료와 댓글은 누구나 읽을 수 있습니다(같은 Firebase 프로젝트에 연결된 선생님들 전용).
- 자료/댓글 삭제는 작성자 본인만 가능합니다 (익명 인증 UID 기준, 같은 브라우저를 계속 사용해야 유지됩니다).
