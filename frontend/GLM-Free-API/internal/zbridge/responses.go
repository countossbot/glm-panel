package zbridge

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "strings"
    "time"
)

func responsesHandler(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
        return
    }
    body, err := io.ReadAll(r.Body)
    if err != nil {
        writeJSON(w, 400, formatOpenAIError("Failed to read body", "invalid_request_error", nil))
        return
    }
    var req struct {
        Model string `json:"model"`
        Input json.RawMessage `json:"input"`
        Instructions string `json:"instructions"`
        Stream *bool `json:"stream"`
        Reasoning json.RawMessage `json:"reasoning"`
        Tools json.RawMessage `json:"tools"`
        Temperature *float64 `json:"temperature"`
        MaxOutputTokens *int `json:"max_output_tokens"`
    }
    if err := json.Unmarshal(body, &req); err != nil {
        writeJSON(w, 400, formatOpenAIError("Invalid JSON", "invalid_request_error", nil))
        return
    }
    if req.Model == "" { req.Model = "glm-5" }
    messages, err := responsesInputToMessages(req.Input, req.Instructions)
    if err != nil {
        writeJSON(w, 400, formatOpenAIError(err.Error(), "invalid_request_error", nil))
        return
    }
    chatReq := map[string]interface{}{"model": req.Model, "messages": messages, "stream": true}
    if len(req.Reasoning) > 0 {
        var reasoning map[string]interface{}
        if json.Unmarshal(req.Reasoning, &reasoning) == nil {
            if effort, ok := reasoning["effort"].(string); ok && effort != "" {
                chatReq["reasoning_effort"] = effort
            }
        }
    }
    if len(req.Tools) > 0 { chatReq["tools"] = json.RawMessage(req.Tools) }
    if req.Temperature != nil { chatReq["temperature"] = *req.Temperature }
    if req.MaxOutputTokens != nil { chatReq["max_tokens"] = *req.MaxOutputTokens }

    chatBody, _ := json.Marshal(chatReq)
    chatReqHTTP := r.Clone(r.Context())
    chatReqHTTP.Method = http.MethodPost
    chatReqHTTP.URL.Path = "/v1/chat/completions"
    chatReqHTTP.Body = io.NopCloser(bytes.NewReader(chatBody))
    chatReqHTTP.ContentLength = int64(len(chatBody))

    rw := &responsesWriter{
        header: w.Header(), underlying: w, model: req.Model,
        responseID: "resp_" + generateID(), created: time.Now().Unix(),
        stream: req.Stream == nil || *req.Stream,
    }
    chatCompletionsHandler(rw, chatReqHTTP)
}

func responsesInputToMessages(input json.RawMessage, instructions string) ([]map[string]interface{}, error) {
    out := []map[string]interface{}{}
    if strings.TrimSpace(instructions) != "" {
        out = append(out, map[string]interface{}{"role": "system", "content": instructions})
    }
    if len(input) == 0 || string(input) == "null" { return nil, fmt.Errorf("input is required") }
    var textInput string
    if json.Unmarshal(input, &textInput) == nil {
        out = append(out, map[string]interface{}{"role": "user", "content": textInput})
        return out, nil
    }
    var items []json.RawMessage
    if err := json.Unmarshal(input, &items); err != nil { return nil, fmt.Errorf("input must be a string or array") }
    for _, raw := range items {
        var item struct {
            Type string `json:"type"`
            Role string `json:"role"`
            Content json.RawMessage `json:"content"`
            Text string `json:"text"`
        }
        if json.Unmarshal(raw, &item) != nil { continue }
        role := item.Role
        if role == "" {
            if item.Type == "message" { role = "user" } else if item.Type == "input_text" { role = "user" } else if item.Type == "output_text" { role = "assistant" } else { continue }
        }
        if role == "developer" { role = "system" }
        if role != "system" && role != "user" && role != "assistant" { continue }
        content := responsesContentToChatContent(item.Content, item.Text)
        if content != "" { out = append(out, map[string]interface{}{"role": role, "content": content}) }
    }
    if len(out) == 0 { return nil, fmt.Errorf("input contains no supported messages") }
    return out, nil
}

func responsesContentToChatContent(raw json.RawMessage, fallback string) string {
    if fallback != "" { return fallback }
    if len(raw) == 0 || string(raw) == "null" { return "" }
    var s string
    if json.Unmarshal(raw, &s) == nil { return s }
    var parts []json.RawMessage
    if json.Unmarshal(raw, &parts) != nil { return "" }
    var b strings.Builder
    for _, p := range parts {
        var part struct { Type string `json:"type"`; Text string `json:"text"` }
        if json.Unmarshal(p, &part) == nil && part.Text != "" {
            if part.Type == "" || part.Type == "input_text" || part.Type == "output_text" || part.Type == "text" { b.WriteString(part.Text) }
        }
    }
    return b.String()
}

type responsesWriter struct {
    header http.Header
    underlying http.ResponseWriter
    model, responseID string
    created int64
    stream, started, completed bool
    fullText strings.Builder
}

func (rw *responsesWriter) Header() http.Header { return rw.header }
func (rw *responsesWriter) WriteHeader(status int) { rw.underlying.WriteHeader(status) }
func (rw *responsesWriter) Flush() { if f, ok := rw.underlying.(http.Flusher); ok { f.Flush() } }

func (rw *responsesWriter) start() {
    if rw.started { return }
    rw.started = true
    rw.header.Set("Content-Type", "text/event-stream")
    rw.header.Set("Cache-Control", "no-cache")
    rw.header.Set("Connection", "keep-alive")
    rw.header.Set("X-Accel-Buffering", "no")
    rw.emit("response.created", map[string]interface{}{"type":"response.created","response":map[string]interface{}{"id":rw.responseID,"object":"response","created_at":rw.created,"status":"in_progress","model":rw.model,"output":[]interface{}{}}})
    rw.emit("response.in_progress", map[string]interface{}{"type":"response.in_progress","response":map[string]interface{}{"id":rw.responseID,"object":"response","status":"in_progress"}})
}

func (rw *responsesWriter) Write(p []byte) (int, error) {
    if !rw.stream { return rw.writeNonStream(p) }
    rw.start()
    for _, line := range strings.Split(string(p), "\n") {
        line = strings.TrimSpace(line)
        if !strings.HasPrefix(line, "data:") { continue }
        data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
        if data == "" || data == "[DONE]" { continue }
        var chunk struct {
            Choices []struct {
                Delta struct { Content string `json:"content"`; ReasoningContent string `json:"reasoning_content"` } `json:"delta"`
                FinishReason interface{} `json:"finish_reason"`
            } `json:"choices"`
        }
        if json.Unmarshal([]byte(data), &chunk) != nil || len(chunk.Choices) == 0 { continue }
        delta := chunk.Choices[0].Delta.Content
        if delta != "" {
            rw.fullText.WriteString(delta)
            rw.emit("response.output_text.delta", map[string]interface{}{"type":"response.output_text.delta","delta":delta,"response_id":rw.responseID,"item_id":rw.responseID+"_item","output_index":0,"content_index":0})
        }
        if chunk.Choices[0].FinishReason != nil && !rw.completed {
            rw.completed = true
            rw.emit("response.output_text.done", map[string]interface{}{"type":"response.output_text.done","text":rw.fullText.String(),"response_id":rw.responseID,"item_id":rw.responseID+"_item","output_index":0,"content_index":0})
            rw.emit("response.completed", map[string]interface{}{"type":"response.completed","response":map[string]interface{}{"id":rw.responseID,"object":"response","created_at":rw.created,"status":"completed","model":rw.model}})
        }
    }
    return len(p), nil
}

func (rw *responsesWriter) writeNonStream(p []byte) (int, error) {
    var completion struct {
        Choices []struct { Message struct { Content string `json:"content"` } `json:"message"` } `json:"choices"`
    }
    if json.Unmarshal(p, &completion) != nil { return len(p), nil }
    text := ""
    if len(completion.Choices) > 0 { text = completion.Choices[0].Message.Content }
    response := map[string]interface{}{"id":rw.responseID,"object":"response","created_at":rw.created,"status":"completed","model":rw.model,"output":[]interface{}{map[string]interface{}{"id":rw.responseID+"_item","type":"message","status":"completed","role":"assistant","content":[]interface{}{map[string]interface{}{"type":"output_text","text":text,"annotations":[]interface{}{}}}}},"output_text":text}
    rw.header.Set("Content-Type","application/json")
    data, _ := json.Marshal(response)
    return rw.underlying.Write(data)
}

func (rw *responsesWriter) emit(event string, data interface{}) {
    payload, _ := json.Marshal(data)
    fmt.Fprintf(rw.underlying, "event: %s\ndata: %s\n\n", event, payload)
    rw.Flush()
}
