# Docker 部署

本项目提供一体化 Docker 镜像，容器内部同时运行 Next.js、Go Bridge、Token Watchdog 和 Token Collector。宿主机只暴露 3000，Go Bridge 的 3001 不映射到宿主机。

## 使用已发布镜像

首次部署：

    cp .env.example .env

按需填写：

    ALIYUN_CAPTCHA_ACCESS_KEY=
    ALIYUN_CAPTCHA_SECRET=

启动：

    docker compose pull
    docker compose up -d

访问：

    http://localhost:3000

查看状态：

    docker compose ps
    docker compose logs -f

停止：

    docker compose down

Token 数据、管理配置和运行日志保存在 Compose named volume glm-runtime 中。删除容器不会删除该 volume。

## 镜像架构

GitHub Actions 会为 main 和版本标签自动构建并发布：

    linux/amd64
    linux/arm64

用户不需要在本机安装 Go、Node.js、Chromium 或 Playwright。

## 本地构建

如果本机安装 Docker，可直接：

    docker build -t glm-panel:local .

## 端口

唯一的宿主机映射：

    3000:3000

容器内部：

    Next.js  -> 3000
    zai-api  -> 3001

3001 不应该在 docker-compose.yml 中增加端口映射。
