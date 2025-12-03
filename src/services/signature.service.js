import redisService from './redis.service.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';

/**
 * Thought Signature 管理服务
 * 用于存储和检索 Gemini API 的 thought signatures
 */
class SignatureService {
  constructor() {
    this.SIGNATURE_TTL = 3600; // 1小时过期
    this.KEY_PREFIX = 'thought_sig';
  }

  /**
   * 生成消息的哈希值作为 key
   * @param {string} user_id - 用户ID
   * @param {Array} messages - 消息数组
   * @returns {string} 哈希值
   */
  generateMessageHash(user_id, messages) {
    // 使用最后一条用户消息的内容生成哈希
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user' || m.role === 'system');
    if (!lastUserMessage) {
      return null;
    }
    
    const content = typeof lastUserMessage.content === 'string' 
      ? lastUserMessage.content 
      : JSON.stringify(lastUserMessage.content);
    
    const hash = crypto.createHash('sha256')
      .update(`${user_id}:${content}`)
      .digest('hex')
      .substring(0, 16);
    
    return hash;
  }

  /**
   * 存储 thought signatures
   * @param {string} user_id - 用户ID
   * @param {Array} messages - 消息数组
   * @param {Array} signatures - signature 数组，每个元素包含 {type, signature, index}
   */
  async storeSignatures(user_id, messages, signatures) {
    if (!signatures || signatures.length === 0) {
      return;
    }

    const hash = this.generateMessageHash(user_id, messages);
    if (!hash) {
      logger.warn('无法生成消息哈希，跳过存储 signatures');
      return;
    }

    const key = `${this.KEY_PREFIX}:${user_id}:${hash}`;
    
    try {
      await redisService.set(key, JSON.stringify(signatures), this.SIGNATURE_TTL);
      logger.info(`已存储 ${signatures.length} 个 thought signatures: key=${key}`);
    } catch (error) {
      logger.error('存储 thought signatures 失败:', error.message);
    }
  }

  /**
   * 检索 thought signatures
   * @param {string} user_id - 用户ID  
   * @param {Array} messages - 消息数组
   * @returns {Promise<Array|null>} signature 数组或 null
   */
  async retrieveSignatures(user_id, messages) {
    const hash = this.generateMessageHash(user_id, messages);
    if (!hash) {
      return null;
    }

    const key = `${this.KEY_PREFIX}:${user_id}:${hash}`;
    
    try {
      const data = await redisService.get(key);
      if (data) {
        const signatures = JSON.parse(data);
        logger.info(`检索到 ${signatures.length} 个 thought signatures: key=${key}`);
        return signatures;
      }
    } catch (error) {
      logger.error('检索 thought signatures 失败:', error.message);
    }
    
    return null;
  }

  /**
   * 从响应中提取 thought signatures
   * @param {Array} parts - 响应的 parts 数组
   * @returns {Array} signature 数组
   */
  extractSignaturesFromResponse(parts) {
    const signatures = [];
    
    if (!parts || !Array.isArray(parts)) {
      return signatures;
    }

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      
      // 提取 text 部分的 thoughtSignature
      if (part.thoughtSignature && (part.text !== undefined || part.thought === true)) {
        signatures.push({
          type: 'text',
          signature: part.thoughtSignature,
          index: i,
          hasThought: part.thought === true
        });
      }
      
      // 提取 functionCall 的 thoughtSignature
      if (part.thoughtSignature && part.functionCall) {
        signatures.push({
          type: 'functionCall',
          signature: part.thoughtSignature,
          index: i,
          functionId: part.functionCall.id
        });
      }
    }
    
    return signatures;
  }
}

const signatureService = new SignatureService();
export default signatureService;