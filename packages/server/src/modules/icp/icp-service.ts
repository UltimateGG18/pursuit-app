import {
  icpConfigSchema,
  icpSlug,
  normalizeIcpConfig,
  zodErrorToDetails,
  type CreateIcpRequest,
  type DeletedIcpDto,
  type IcpProfileDto,
  type IcpProfileListDto,
  type ListIcpQuery,
  type UpdateIcpRequest,
} from '@pursuit/shared';
import { AppError } from '../../shared/errors.js';
import { toIcpProfileDto, toIcpProfileSummaryDto } from './icp-mapper.js';
import type { IcpRepository, IcpWriteInput } from './icp-repository.js';

export class IcpService {
  constructor(private readonly repository: IcpRepository) {}

  /**
   * Turns a validated request into the row we persist.
   *
   * `submittedConfig` is the caller's payload verbatim; `config` is the
   * normalized form. Normalization is re-validated so a normalizer bug can
   * never write a configuration the contract would reject.
   */
  private buildWriteInput(request: CreateIcpRequest): IcpWriteInput {
    const submittedConfig = structuredClone(request.config);
    const normalized = normalizeIcpConfig(request.config);

    const revalidated = icpConfigSchema.safeParse(normalized);
    if (!revalidated.success) {
      throw AppError.internal(
        'Normalized ICP configuration failed validation',
        zodErrorToDetails(revalidated.error, ['config']),
      );
    }
    const config = revalidated.data;

    return {
      name: config.basicProfile.name,
      slug: icpSlug(config),
      description: config.basicProfile.description ?? null,
      status: request.status,
      schemaVersion: config.schemaVersion,
      config,
      submittedConfig,
      scoringWeights: config.scoringWeights,
      createdBy: request.createdBy ?? null,
      changeReason: request.changeReason ?? null,
    };
  }

  private async assertSlugAvailable(slug: string, name: string, allowedId?: string): Promise<void> {
    const existing = await this.repository.findActiveBySlug(slug);
    if (!existing || existing.id === allowedId) return;
    throw AppError.conflict(`An ICP named "${name}" already exists`, [
      { path: 'config.basicProfile.name', message: 'This name is already used by another ICP' },
    ]);
  }

  async create(request: CreateIcpRequest): Promise<IcpProfileDto> {
    const input = this.buildWriteInput(request);
    await this.assertSlugAvailable(input.slug, input.name);
    return toIcpProfileDto(await this.repository.create(input));
  }

  async getById(id: string): Promise<IcpProfileDto> {
    const record = await this.repository.findById(id);
    if (!record) throw AppError.notFound(`No ICP found with id "${id}"`);
    return toIcpProfileDto(record);
  }

  async list(query: ListIcpQuery): Promise<IcpProfileListDto> {
    const { items, total } = await this.repository.list({
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { search: query.search } : {}),
      limit: query.limit,
      offset: query.offset,
    });
    return {
      items: items.map(toIcpProfileSummaryDto),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  /** Full replace: appends a new version rather than mutating the stored one. */
  async update(id: string, request: UpdateIcpRequest): Promise<IcpProfileDto> {
    const existing = await this.repository.findById(id);
    if (!existing) throw AppError.notFound(`No ICP found with id "${id}"`);

    const input = this.buildWriteInput(request);
    await this.assertSlugAvailable(input.slug, input.name, id);

    const updated = await this.repository.replace(id, input);
    if (!updated) throw AppError.notFound(`No ICP found with id "${id}"`);
    return toIcpProfileDto(updated);
  }

  /** Archives the profile; stored versions are retained. */
  async remove(id: string): Promise<DeletedIcpDto> {
    const archived = await this.repository.archive(id);
    if (!archived) throw AppError.notFound(`No ICP found with id "${id}"`);
    return {
      id: archived.id,
      status: archived.status,
      deletedAt: (archived.deletedAt ?? archived.updatedAt).toISOString(),
    };
  }
}
