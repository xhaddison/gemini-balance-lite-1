--[[
  Atomically updates a key's health score, usage stats, and status in Redis.

  KEYS[1] - The key hash in Redis (e.g., "key:sk-...")

  ARGV[1] - success (string "true" or "false")
  ARGV[2] - httpStatusCode (string, e.g., "200", "429")
  ARGV[3] - quota_remaining (string, number of remaining quota, can be empty)
  ARGV[4] - quota_reset_time (string, ISO timestamp for quota reset, can be empty)
  ARGV[5] - current_timestamp (string, ISO timestamp for lastFailure)
--]]

local keyHash = KEYS[1]
local success = ARGV[1] == 'true'
local httpStatusCode = tonumber(ARGV[2])
local quota_remaining = ARGV[3]
local quota_reset_time = ARGV[4]
local current_timestamp = ARGV[5]

-- 1. Read existing key data
local keyData = redis.call('HGETALL', keyHash)
if #keyData == 0 then
  return redis.error_reply("Key not found: " .. keyHash)
end

-- Convert array to table for easier access
local key = {}
for i = 1, #keyData, 2 do
  key[keyData[i]] = keyData[i+1]
end

local current_score = tonumber(key.health_score) or 1.0
local totalUses = tonumber(key.totalUses) or 0
local totalFailures = tonumber(key.totalFailures) or 0
local new_score

local updates = {}

if success then
  -- Health score increases, approaching 1.0
  new_score = current_score + 0.05 * (1 - current_score)
  updates['totalUses'] = totalUses + 1

  -- Update quota info if provided
  if quota_remaining and quota_remaining ~= '' then
    updates['quota_remaining'] = quota_remaining
  end
  if quota_reset_time and quota_reset_time ~= '' then
    updates['quota_reset_time'] = quota_reset_time
  end
else
  -- Health score decreases
  new_score = current_score * 0.75
  updates['totalFailures'] = totalFailures + 1
  updates['lastFailure'] = current_timestamp

  if httpStatusCode then
    if httpStatusCode == 401 or httpStatusCode == 403 then
      updates['status'] = 'disabled'
      updates['reason'] = 'invalid_auth'
    elseif httpStatusCode == 429 then
      updates['status'] = 'disabled'
      updates['reason'] = 'quota_exceeded'
    elseif httpStatusCode >= 500 and httpStatusCode < 600 then
      updates['status'] = 'disabled'
      updates['reason'] = 'server_error'
    end
  end
end

updates['health_score'] = string.format("%.4f", new_score)

-- Recalculate error rate
local finalTotalUses = updates['totalUses'] or totalUses
local finalTotalFailures = updates['totalFailures'] or totalFailures

if finalTotalUses > 0 then
    updates['error_rate'] = string.format("%.4f", finalTotalFailures / finalTotalUses)
end

-- 2. Atomically write all updates back
-- Using unpack since Redis Lua environment might not have table.unpack
local args = {keyHash}
for k, v in pairs(updates) do
    table.insert(args, k)
    table.insert(args, v)
end

return redis.call('HSET', unpack(args))
