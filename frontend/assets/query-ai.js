/* Only the explicit analysis action sends data. The API key remains on the server. */
window.PFQueryAI = {
  timeoutMs: 35000,
  async analyze({description, age, city, scenes}, {signal} = {}) {
    const response = await fetch('/api/ai/analyze', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({description, age, city, scenes}),
      signal,
    });
    let data;
    try {
      data = await response.json();
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error('分析服务返回了无法读取的 JSON。');
    }
    if (!response.ok) {
      const error = new Error(data?.detail || '分析服务暂不可用。');
      error.code = data?.error;
      throw error;
    }
    const fields = ['confirmed_facts', 'inferred_scenes', 'potential_needs',
      'missing_information', 'follow_up_questions', 'uncertainty_notes'];
    if (!fields.every(field => Array.isArray(data?.[field]))) {
      throw new Error('分析结果缺少必要字段。');
    }
    return data;
  },
};
