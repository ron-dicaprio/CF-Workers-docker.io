

# 🐳 CF-Workers-docker.io：Docker仓库镜像代理工具

这个项目是一个基于 Cloudflare Workers 的 Docker 镜像代理工具。它能够中转对 Docker 官方镜像仓库的请求，解决一些访问限制和加速访问的问题。


## 🚀 部署方式

- **Workers** 部署：复制 [_worker.js](https://github.com/ron-dicaprio/CF-Workers-docker.io/blob/main/_worker.js) 代码，`保存并部署`即可
- **Pages** 部署：`Fork` 后 `连接GitHub` 一键部署即可

例如您的Workers项目域名为：`registry.kdns.fr`；

配置两个变量，DOCKER_HUB_TOKEN、DOCKER_HUB_USERNAME 对应dockerhub的账号和凭证 

cloudflare上配置cname ，*.registry.kdns.fr --> registry.kdns.fr 

### 1.官方镜像路径前面加域名

```shell
docker pull registry.kdns.fr/nginx:latest
```

```shell
docker pull hub.registry.kdns.fr/library/nginx:latest
docker pull ghcr.registry.kdns.fr/nginxinc/nginx:latest
......
```

### 2.一键设置镜像加速

修改文件 `/etc/docker/daemon.json`（如果不存在则创建）

```shell
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<-'EOF'
{
  "registry-mirrors": ["https://registry.kdns.fr"] 
}
EOF
sudo systemctl daemon-reload
sudo systemctl restart docker
```


### 🛠 开源代码引用
- [muzihuaner](https://github.com/muzihuaner)
- [V2ex网友](https://global.v2ex.com/t/1007922)
- [ciiiii](https://github.com/ciiiii/cloudflare-docker-proxy)
- [ChatGPT](https://chatgpt.com/)
- [白嫖哥](https://t.me/bestcfipas/1900)
- [zero_free频道](https://t.me/zero_free/80)
- [dongyubin](https://github.com/cmliu/CF-Workers-docker.io/issues/8)
- [kiko923](https://github.com/cmliu/CF-Workers-docker.io/issues/5)
