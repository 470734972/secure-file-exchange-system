# 受控文件交换系统

推荐使用 Rocky Linux 10.2 或以上版本部署。本版本固定监听同一 IP 的两个入口：

- 办公网：`https://192.168.1.205:8080`
- 研发网：`https://192.168.1.205:8081`

两个端口是**逻辑入口区分**，不是网闸或物理隔离。必须在 firewalld、VLAN 或上游 ACL 中限制：办公网只能访问 8080，研发网只能访问 8081。

## 功能

- 本地账号登录；管理员可在页面创建本地用户、授予区域和角色。
- AD 登录：仅接受 LDAPS，按 AD 组映射 `user`、`approver`、`admin`。
- 服务端会话、`HttpOnly`/`SameSite=Strict` Cookie、CSRF 校验和本地密码 scrypt 哈希。
- 文件提交、基础类型与敏感特征拦截、双人审批、目标用户下载、SHA-256 与审计记录。
- 管理员审计台：仅本地 `admin` 角色或映射为 AD 管理员组的用户可查看当前安全区的登录、流转、审批和下载事件。
- 已允许文本、PDF、Office（Word/Excel/PowerPoint）、常见图片、ZIP/RAR/7Z/TAR/GZ 等压缩包、RPM/DEB 和 DWG；可执行文件与脚本仍默认拒绝。

## 部署

在 Rocky 上将项目拷贝到 `/opt/secure-file-exchange` 后执行：

```bash
sudo bash deploy/rocky-install.sh
sudo install -m 0640 -o root -g sfx deploy/sfx.env.example /etc/secure-file-exchange/sfx.env
sudo vi /etc/secure-file-exchange/sfx.env
sudo systemctl enable --now secure-file-exchange
```

## 一键升级

已部署的 Rocky 服务器执行以下命令，可自动备份、拉取最新代码、更新依赖并重启服务：

```bash
cd /opt/secure-file-exchange
sudo ./deploy/rocky-upgrade.sh
```

脚本默认升级 `codex/secure-file-exchange-system` 分支，备份保存到 `/var/backups/secure-file-exchange/<时间戳>/`。检测到本机未提交代码时会安全停止，不会强制覆盖。

先在 `sfx.env` 设置一次性初始管理员（至少 8 位密码）：

```ini
BOOTSTRAP_ADMIN_USERNAME=sfxadmin
BOOTSTRAP_ADMIN_PASSWORD=replace-with-a-long-random-secret
```

首次服务启动会创建管理员；随后从环境文件删除 `BOOTSTRAP_ADMIN_PASSWORD` 并执行 `sudo systemctl restart secure-file-exchange`。

## AD / Microsoft Active Directory

使用只读服务账号与企业 CA 证书，禁止 `ldap://` 和跳过证书校验：

```ini
LDAP_URL=ldaps://ad.example.local:636
LDAP_BIND_DN=CN=sfx-reader,OU=Service Accounts,DC=example,DC=local
LDAP_BIND_PASSWORD=replace-this-secret
LDAP_BASE_DN=DC=example,DC=local
LDAP_TLS_CA_FILE=/etc/pki/ca-trust/source/anchors/ad-ca.pem
LDAP_ADMIN_GROUPS=CN=SFX-Admins,OU=Groups,DC=example,DC=local
LDAP_APPROVER_GROUPS=CN=SFX-Approvers,OU=Groups,DC=example,DC=local
```

AD 用户首次成功认证才创建本地身份记录；非映射组默认普通用户。不要创建与 AD 用户同名的本地账户。

## 必须完成的网络与安全项

1. 生产必须配置 `TLS_CERT_FILE`、`TLS_KEY_FILE` 和 `COOKIE_SECURE=true`，使用 HTTPS。
2. 替换部署脚本的 `OFFICE_CIDR` 和 `RD_CIDR`，分别放行 8080、8081；不要在 public zone 开放两个端口。
3. 保持 SELinux Enforcing；不要关闭 SELinux 或防火墙。
4. 每日备份 `/var/lib/secure-file-exchange` 与 `/etc/secure-file-exchange/sfx.env`（加密保存）。

## 验收

- `systemctl is-active secure-file-exchange` 显示 `active`。
- 办公网访问 8080、研发网访问 8081，页面应显示对应区域。
- 管理员创建一个办公审批人、一个研发接收人；办公用户上传 → 审批人批准 → 研发接收人下载。
- 尝试上传 `.exe` 或含 `SECRET` 的 TXT，必须拒绝。
- 跨网段访问非本区端口必须被防火墙拒绝。

本系统仍不包含网闸、多引擎杀毒、沙箱、CDR、真实 DLP、HA 或不可篡改审计，涉密/高保密场景必须在这些能力之上建设。
