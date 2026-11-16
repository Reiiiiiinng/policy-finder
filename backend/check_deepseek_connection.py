"""Local CLI only. No HTTP test endpoint; real calls require explicit --live."""
import argparse
import sys
from deepseek_client import DeepSeekClient, DeepSeekError


def main():
    parser = argparse.ArgumentParser(description="DeepSeek 本地连通性测试（不打印密钥或原始响应）")
    parser.add_argument("--live", action="store_true", help="向官方接口发送一次小型真实请求，会使用 API 配额")
    parser.add_argument("--timeout", type=float, default=30, help="网络超时秒数，默认 30")
    args = parser.parse_args()
    try:
        client = DeepSeekClient.from_env(timeout=args.timeout)
        if not args.live:
            print("本地配置检查通过；未联网。加 --live 执行一次真实连通性测试。")
            return 0
        result = client.chat_json([
            {"role": "system", "content": 'Connectivity test only. Return JSON exactly like {"ok": true}.'},
            {"role": "user", "content": 'Respond with the JSON object {"ok": true}. No personal data is involved.'},
        ], max_tokens=128)
        if result.get("ok") is not True:
            raise DeepSeekError("TEST_RESPONSE", "已收到响应，但连通性测试 JSON 未通过校验。")
        print("DeepSeek 真实连通性测试通过：非思考模式，JSON 对象校验通过。")
        return 0
    except DeepSeekError as exc:
        status = f" HTTP {exc.status}" if exc.status is not None else ""
        print(f"测试未通过 [{exc.code}{status}]：{exc}", file=sys.stderr)
        return 2
    except Exception:
        # Defensive safe boundary: no exception repr/traceback can reveal credentials.
        print("测试未通过 [LOCAL_ERROR]：本地运行异常；未输出请求、响应或密钥。", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
