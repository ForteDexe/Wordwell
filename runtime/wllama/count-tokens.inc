// Included inside wllama_context. Reuse the inference chat formatter and
// tokenizer, without posting a task or evaluating any model layers.
glue_msg_get_result_res action_count_tokens(const char *req_raw)
{
  PARSE_REQ(glue_msg_completion_req);
  glue_msg_get_result_res res;
  res.has_more.value = false;
  try
  {
    if (!vocab || !meta) throw app_exception("Load a model before counting tokens");
    json body = json::parse(req.data_json.value);
    const std::string text = body.at("messages").back().at("content").get<std::string>();
    std::vector<raw_buffer> files;
    const json formatted = oaicompat_chat_params_parse(body, meta->chat_params, files);
    const auto prompts = tokenize_input_prompts(vocab, nullptr, formatted.at("prompt"), true, true, mtmd_helper_init_opt_default());
    if (prompts.size() != 1) throw app_exception("Expected one text prompt");
    res.data_json.value = json({
      {"prompt_tokens", prompts[0].size()},
      {"text_tokens", common_tokenize(vocab, text, false, true).size()}
    }).dump();
    res.success.value = true;
    res.is_error.value = false;
  }
  catch (const std::exception &e)
  {
    res.success.value = false;
    res.is_error.value = true;
    res.data_json.value = json({{"error", e.what()}}).dump();
  }
  return res;
}
