# 🐳 Guia Prático: Rodando o Projeto com Docker

## Status Rápido

Seu projeto está configurado para rodar **100% via Docker** com:
- ✅ **API NestJS** em `localhost:3005`
- ✅ **PostgreSQL** em `localhost:5432`
- ✅ **Redis** em `localhost:6379`
- ✅ **Migrations** aplicadas automaticamente

---

## 📋 Comandos Essenciais do Dia a Dia

### 1️⃣ **Iniciar o projeto (primeira vez ou restart completo)**
```bash
docker compose up -d --build
```
- Constrói a image, sobe API, PostgreSQL e Redis
- Espera ~3-4 minutos na primeira vez
- Ideal para: setup inicial, mudanças no Dockerfile

### 2️⃣ **Apenas ligar os containers (sem rebuild)**
```bash
docker compose up -d
```
- Mais rápido (~10 segundos)
- Use quando só quer ligar/desligar
- Se não existem as imagens, ele reclama (use #1)

### 3️⃣ **Parar tudo**
```bash
docker compose down
```
- Para API, PostgreSQL, Redis
- Mantém os dados nos volumes
- Limpa rede e containers

### 4️⃣ **Parar e limpar TUDO (perda de dados!)**
```bash
docker compose down -v
```
- Para e remove volumes
- **Cuidado**: apaga dados do DB e Redis
- Use apenas em emergência ou dev limpo

---

## 🔍 Ver o Que Está Acontecendo

### Logs em real-time (siga o stream)
```bash
# Todos os serviços
docker compose logs -f

# Só a API
docker compose logs -f api

# Últimas 50 linhas (uma vez)
docker compose logs api --tail=50
```

### Status dos containers
```bash
docker compose ps
```

---

## 🗄️ Banco de Dados

### Conectar via psql local
```bash
psql -h localhost -U nestjs -d nestjs -p 5432
# senha: password
```

### Visualizar dados com Prisma Studio
```bash
docker compose exec api npx prisma studio
# Abre interface em http://localhost:5555
```

### Aplicar novas migrations (se criou uma)
```bash
docker compose exec api npx prisma migrate deploy
```

### Reset do banco (⚠️ perda de dados)
```bash
docker compose exec api npx prisma migrate reset
```

---

## 🔄 Workflow Típico de Desenvolvimento

### **Cenário 1: Mudei código TypeScript**
```bash
# Rebuild e restart
docker compose up -d --build
```

### **Cenário 2: Mudei schema.prisma**
```bash
# 1. Criar migration
docker compose exec api npx prisma migrate dev --name meu_nome

# 2. Rebuild API (para gerar client)
docker compose up -d --build
```

### **Cenário 3: Só quero limpar logs e reiniciar**
```bash
docker compose restart api
```

### **Cenário 4: Quero debugar direto no DB**
```bash
docker compose exec postgresql psql -U nestjs -d nestjs
```

### **Cenário 5: Preciso restaurar backup local**
```bash
# 1. Export do banco local (uma vez)
pg_dump -h localhost -U postgres -d pelezi-bot -F p > backup.sql

# 2. Copy para container
docker cp backup.sql whatsapp-pelezi-bot-api-postgresql-1:/tmp/

# 3. Restaurar
docker compose exec -T postgresql psql -U nestjs -d nestjs -f /tmp/backup.sql
```

---

## 🚨 Troubleshooting Comum

### "Container not starting" / conexão recusada
```bash
# Verificar logs
docker compose logs api

# Geralmente: pode restartar
docker compose restart api

# Se persistir: rebuild
docker compose up -d --build
```

### "Database connection refused"
- Normalmente o PostgreSQL demora 10-15s para iniciar
- Use: `docker compose logs postgresql` para ver progresso

### "Redis connection refused" (ECONNREFUSED 6379)
- Redis está fora, restart ajuda:
```bash
docker compose restart redis
```

### "Port already in use"
```bash
# Liberar portas (Windows)
netstat -ano | findstr :3005
taskkill /PID <PID> /F

# Ou mudar portas no docker-compose.yml
```

### Dados desapareceram após `docker compose down`
- **Normal!** Os volumes são preservados, mas se você fez `down -v`, perdeu
- Os dados estão em: `whatsapp-pelezi-bot-api_postgresql_data`
- Restaure com o backup se tiver

---

## 📦 Monitoramento de Saúde

### Health check da API
```bash
curl http://localhost:3005/api/v1/health
```

### Verificar Redis
```bash
docker compose exec redis redis-cli ping
# Resposta: PONG ✅
```

### Verificar Postgres
```bash
docker compose exec -T postgresql psql -U nestjs -c "SELECT version();"
```

---

## 🎯 Variáveis de Ambiente

As variáveis já estão em `.env` local:
```
DATABASE_URL=postgresql://nestjs:password@postgresql:5432/nestjs?schema=public
REDIS_URL=redis://redis:6379
API_PORT=3000
```

**Não precisa mudar** — Docker compose substitui `localhost` por nomes de serviço automaticamente.

---

## 🔐 Segurança & Produção

⚠️ **Não use esses values em produção!**
- PostgreSQL password: `password` (padrão)
- Redis: sem autenticação (padrão)
- API keys: públicas no `.env` exemplo

Para produção, usar `.env.production` com secrets do Docker Secrets ou Vault.

---

## 📊 Estrutura dos Volumes

```
whatsapp-pelezi-bot-api_postgresql_data   → Banco de dados Postgres
whatsapp-pelezi-bot-api_redis_data        → Cache Redis persistente
```

Se precisar deletar e recriar: `docker volume rm nome_do_volume`

---

## 🚀 Quick Reference Card

| Ação | Comando |
|------|---------|
| Ligar tudo | `docker compose up -d --build` |
| Desligar | `docker compose down` |
| Logs | `docker compose logs -f api` |
| Status | `docker compose ps` |
| Restart API | `docker compose restart api` |
| Terminal no container | `docker compose exec api sh` |
| Ver DB visualmente | `docker compose exec api npx prisma studio` |
| Conectar ao Postgres | `psql -h localhost -U nestjs -d nestjs` |
| Reset do DB | `docker compose exec api npx prisma migrate reset` |
| Parar sem perder dados | `docker compose down` |
| Parar e apagar tudo | `docker compose down -v` |

---

## 💡 Pro Tips

1. **Alias útil** (adicione ao PowerShell Profile):
```powershell
function dcup { docker compose up -d --build }
function dcdown { docker compose down }
function dclogs { docker compose logs -f }
```

2. **Watch logs em tempo real** enquanto desenvolve:
```bash
# Terminal 1: rodando dev
docker compose logs -f api

# Terminal 2: seu editor
# Terminal 3: testes/curl
```

3. **Backup automático antes de mudar schema**:
```bash
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
docker compose exec -T postgresql pg_dump -U nestjs nestjs > "backup_$timestamp.sql"
```

4. **Limpar imagens não usadas**:
```bash
docker image prune -a
```

---

## 🎓 Próximos Passos

- **Phase 5 (em breve)**: BullMQ + Filas de processamento
  - Os containers Redis e PostgreSQL já estão prontos para isso
  - Será integração direta, sem mudanças de infra

- **CI/CD**: Setup GitHub Actions para build + push em cada PR

- **Multistage**: Dockerfile já está otimizado para production

---

**Dúvidas?** Verifique os logs primeiro: `docker compose logs -f`
